"""자동 관리 룰 평가 엔진 (async)."""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.auto_rule import AutoRule, AutoRuleLog
from app.services.meta_ads_service import MetaAdsService

logger = logging.getLogger(__name__)


def _extract_metric(insight: dict, metric: str):
    direct = {"cpc": "cpc", "ctr": "ctr", "cpm": "cpm", "spend": "spend", "frequency": "frequency"}
    if metric in direct:
        val = insight.get(direct[metric])
        return float(val) if val else None

    spend = float(insight.get("spend", 0) or 0)
    clicks = float(insight.get("clicks", 0) or 0)
    actions = insight.get("actions") or []
    action_values = insight.get("action_values") or []

    conversions = 0
    purchase_value = 0
    for a in actions:
        if a.get("action_type") in ("purchase", "offsite_conversion.fb_pixel_purchase"):
            conversions += float(a.get("value", 0))
    for av in action_values:
        if av.get("action_type") in ("purchase", "offsite_conversion.fb_pixel_purchase"):
            purchase_value += float(av.get("value", 0))

    if metric == "roas":
        return (purchase_value / spend) if spend > 0 else None
    if metric == "cvr":
        return (conversions / clicks * 100) if clicks > 0 else None
    return None


def _compare(value: float, operator: str, threshold: float) -> bool:
    ops = {"gt": value > threshold, "lt": value < threshold,
           "gte": value >= threshold, "lte": value <= threshold}
    return ops.get(operator, False)


async def evaluate_rule(rule: AutoRule, svc: MetaAdsService) -> list[dict]:
    triggered = []

    if rule.target_id:
        targets = [{"id": rule.target_id, "name": rule.target_name or rule.target_id}]
    else:
        try:
            overview = await svc.get_account_overview("last_7d")
            campaigns = overview.get("campaigns", [])
            targets = []
            for c in campaigns:
                if c.get("effective_status") != "ACTIVE":
                    continue
                ins = c.get("insights", {}).get("data", [{}])
                insight = ins[0] if ins else {}
                if rule.target_type == "campaign":
                    targets.append({"id": c["id"], "name": c.get("name", ""), "insights": insight})
                elif rule.target_type == "adset":
                    for adset in c.get("adsets", {}).get("data", []):
                        if adset.get("effective_status") != "ACTIVE":
                            continue
                        ai = adset.get("insights", {}).get("data", [{}])
                        targets.append({"id": adset["id"], "name": adset.get("name", ""), "insights": ai[0] if ai else {}})
                elif rule.target_type == "ad":
                    for adset in c.get("adsets", {}).get("data", []):
                        for ad in adset.get("ads", {}).get("data", []):
                            if ad.get("effective_status") != "ACTIVE":
                                continue
                            ai = ad.get("insights", {}).get("data", [{}])
                            targets.append({"id": ad["id"], "name": ad.get("name", ""), "insights": ai[0] if ai else {}})
        except Exception as e:
            logger.error(f"Failed to fetch targets for rule {rule.id}: {e}")
            return []

    for target in targets:
        insight = target.get("insights", {})
        if not insight:
            continue
        val = _extract_metric(insight, rule.metric)
        if val is None:
            continue
        if not _compare(val, rule.operator, rule.threshold):
            continue
        if rule.secondary_metric:
            sec_val = _extract_metric(insight, rule.secondary_metric)
            if sec_val is None or not _compare(sec_val, rule.secondary_operator, rule.secondary_threshold):
                continue
        triggered.append({"target": target, "metric_value": val})

    return triggered


async def execute_action(rule: AutoRule, target: dict, svc: MetaAdsService):
    target_id = target["id"]
    try:
        if rule.action == "pause":
            if rule.target_type == "campaign":
                await svc.update_campaign_status(target_id, "PAUSED")
            elif rule.target_type == "adset":
                await svc.update_adset_status(target_id, "PAUSED")
            elif rule.target_type == "ad":
                await svc.update_ad_status(target_id, "PAUSED")
            return "paused"
        elif rule.action in ("decrease_budget", "increase_budget"):
            pct = rule.action_value or 20
            multiplier = (1 - pct / 100) if rule.action == "decrease_budget" else (1 + pct / 100)
            # For budget changes we'd need current budget - simplified approach
            if rule.target_type == "campaign":
                await svc.update_campaign_budget(target_id, None)  # placeholder
            return "budget_decreased" if rule.action == "decrease_budget" else "budget_increased"
    except Exception as e:
        logger.error(f"Action failed for rule {rule.id}, target {target_id}: {e}")
    return None


async def run_rules(db: AsyncSession, user_id: str, svc: MetaAdsService, rule_ids=None) -> list[dict]:
    query = select(AutoRule).where(AutoRule.user_id == user_id, AutoRule.enabled == True)
    if rule_ids:
        query = query.where(AutoRule.id.in_(rule_ids))
    result = await db.execute(query)
    rules = result.scalars().all()

    logs = []
    for rule in rules:
        triggered = await evaluate_rule(rule, svc)
        for item in triggered:
            target = item["target"]
            metric_value = item["metric_value"]
            action_taken = await execute_action(rule, target, svc)
            if action_taken:
                log = AutoRuleLog(
                    id=str(uuid.uuid4()), rule_id=rule.id, user_id=user_id,
                    action_taken=action_taken, target_type=rule.target_type,
                    target_id=target["id"], target_name=target.get("name"),
                    metric_name=rule.metric, metric_value=metric_value,
                    threshold_value=rule.threshold,
                    details={"rule_name": rule.name, "action_value": rule.action_value},
                    triggered_at=datetime.now(timezone.utc),
                )
                db.add(log)
                rule.times_triggered = (rule.times_triggered or 0) + 1
                logs.append({
                    "rule_id": rule.id, "rule_name": rule.name, "action": action_taken,
                    "target_id": target["id"], "target_name": target.get("name"),
                    "metric": rule.metric, "metric_value": metric_value, "threshold": rule.threshold,
                })
        rule.last_checked_at = datetime.now(timezone.utc)

    await db.commit()
    return logs
