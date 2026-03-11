// User types
export interface User {
  id: number;
  email: string;
  full_name?: string;
  company_name?: string;
  is_active: boolean;
  created_at: string;
  meta_connected: boolean;
  meta_user_id?: string;
  meta_ad_account_id?: string;
  meta_ig_account_id?: string;
  brand_settings?: BrandSettings;
}

export interface BrandSettings {
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  brand_voice?: string;
}

// Benchmark types
export interface BenchmarkQuery {
  query: string;
  period: '7d' | '30d' | '90d';
  sort_by: 'popular' | 'recent' | 'most_comments';
  limit: number;
}

export interface CollectedPost {
  id: number;
  post_id: string;
  post_url?: string;
  media_url?: string;
  media_type: string;
  caption?: string;
  hashtags: string[];
  metrics: {
    likes: number;
    comments: number;
    shares: number;
    estimated_reach: number;
    engagement_rate: number;
  };
  posted_at?: string;
}

export interface ContentTrend {
  topic: string;
  description: string;
  engagement_level: string;
  examples: string[];
}

export interface HashtagGroup {
  theme: string;
  hashtags: string[];
  avg_engagement: number;
  recommendation: string;
}

export interface ContentPillar {
  pillar_name: string;
  description: string;
  content_ratio: number;
  example_topics: string[];
}

export interface MarketIntelligenceReport {
  market_overview: string;
  content_trends: ContentTrend[];
  hashtag_groups: HashtagGroup[];
  content_pillars: ContentPillar[];
  competitor_insights: string[];
  recommendations: string[];
}

export interface BenchmarkResponse {
  id: number;
  query: string;
  benchmark_type: string;
  total_posts_analyzed: number;
  avg_engagement_rate: number;
  posts: CollectedPost[];
  ai_summary?: AISummary;
  sentiment_analysis?: SentimentAnalysis;
  data_source: string; // "meta_api" or "ai"
  ai_report?: MarketIntelligenceReport;
  created_at: string;
}

export interface AISummary {
  summary: string;
  key_insights: string[];
  recommendations: string[];
  trending_topics: string[];
}

export interface SentimentAnalysis {
  overall_sentiment: string;
  positive_keywords: { keyword: string; count: number; sentiment: string }[];
  negative_keywords: { keyword: string; count: number; sentiment: string }[];
  word_cloud_data: { word: string; weight: number; sentiment: string }[];
}

export interface StyleExtraction {
  visual_style: string;
  color_palette: string[];
  composition: string;
  text_overlay: boolean;
  tone_and_manner: string;
  appeal_type: string;
  key_elements: string[];
}

// Creative types
export interface Creative {
  id: number;
  user_id: number;
  name: string;
  creative_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL';
  format: '1:1' | '4:5' | '9:16' | '16:9';
  headline?: string;
  primary_text?: string;
  call_to_action?: string;
  file_url?: string;
  thumbnail_url?: string;
  created_at: string;
  updated_at: string;
}

export interface GenerationJob {
  job_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  results?: Creative[];
  error_message?: string;
}

// Campaign Objective & Budget types
export type CampaignObjective = 'TRAFFIC' | 'CONVERSIONS' | 'PURCHASE' | 'LEAD_GENERATION' | 'AWARENESS' | 'ENGAGEMENT' | 'APP_PROMOTION';

export type BudgetType = 'DAILY' | 'LIFETIME';

export type CampaignStatusType = 'ACTIVE' | 'PAUSED' | 'PENDING_REVIEW' | 'ARCHIVED' | 'DELETED';

export interface PublishOptions {
  campaign_id: number;
  launch_immediately: boolean;
  budget_type: BudgetType;
  advantage_plus: boolean;
  advantage_plus_audience: boolean;
  dataset_id?: string;
  pixel_id?: string;
  currency: string;
}

export interface TargetingSegment {
  type: 'BROAD' | 'RETARGET' | 'INTEREST';
  name: string;
  enabled: boolean;
  ratio: number;  // percentage 0-100
  targeting: TargetingConfig;
  schedule?: {
    start_date?: string;
    end_date?: string;
  };
  daily_budget?: number;
  age_range?: string;
  gender?: string;
  interests?: string[];
  description?: string;
  custom_audiences?: string[];
  exclusion_audiences?: string[];
  start_date?: string;
  end_date?: string;
}

// Campaign types
export interface Campaign {
  id: number;
  user_id: number;
  name: string;
  objective: CampaignObjective;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  total_budget: number;
  daily_budget?: number;
  spent_amount: number;
  targeting?: TargetingConfig;
  targeting_segments?: TargetingSegment[];
  meta_campaign_id?: string;
  start_date?: string;
  end_date?: string;
  budget_type?: BudgetType;
  advantage_plus?: boolean;
  advantage_plus_audience?: boolean;
  dataset_id?: string;
  pixel_id?: string;
  ads: Ad[];
  created_at: string;
  updated_at: string;
}

export interface Ad {
  id: number;
  campaign_id: number;
  creative_id: number;
  name: string;
  status: string;
  budget_percentage: number;
  meta_ad_id?: string;
  created_at: string;
}

export interface TargetingConfig {
  age_range: { min_age: number; max_age: number };
  genders: string[];
  geo: { countries: string[]; cities?: string[] };
  interests: { interests: string[]; behaviors?: string[] };
}

export interface StrategyRecommendation {
  total_budget: number;
  recommended_duration_days: number;
  allocations: {
    creative_id: number;
    creative_name: string;
    allocation_percentage: number;
    recommended_placement: string;
  }[];
  target_audience_summary: string;
  expected_reach: number;
  expected_ctr: number;
  reasoning: string;
}

// Analytics types
export interface KPIMetrics {
  total_spend: number;
  total_impressions: number;
  total_clicks: number;
  total_conversions: number;
  total_revenue: number;
  roas: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversion_rate: number;
}

export interface DailyMetrics {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  ctr: number;
  cpc: number;
  roas: number;
}

export interface CreativePerformance {
  creative_id: number;
  creative_name: string;
  creative_type: string;
  thumbnail_url?: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  conversion_rate: number;
  roas: number;
  is_winner: boolean;
}

export interface AIInsight {
  insight_type: string;
  title: string;
  description: string;
  action_available: boolean;
  action_type?: string;
  action_params?: Record<string, any>;
}

export interface PerformanceDashboard {
  period_start: string;
  period_end: string;
  kpi_summary: KPIMetrics;
  daily_trend: DailyMetrics[];
  creative_performance: CreativePerformance[];
  comparison?: {
    winner: CreativePerformance;
    loser: CreativePerformance;
    performance_difference: number;
    statistical_significance: number;
    recommendation: string;
  };
  ai_insights: AIInsight[];
}

// Auto Plan types (One-Click Campaign)
export interface AutoPlanRequest {
  product_url?: string;
  product_name?: string;
  product_description?: string;
  product_price?: number;
  budget: number;
  start_date?: string;
  end_date?: string;
}

export interface AutoPlanResponse {
  product_info: Record<string, any>;
  campaign_structure: Record<string, any>;
  targeting: Record<string, any>;
  copywriting: Record<string, any>;
  utm_links: Record<string, any>[];
  overall_strategy: string;
  meta_recommendations?: string;
  creative_recommendation?: Record<string, any>;
}

// Meta Campaign (from API)
export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
  insights?: Record<string, any>;
}

// Campaign Metrics & Performance Feedback types
export interface CampaignMetrics {
  campaign_id: string;
  campaign_name: string;
  status: CampaignStatusType;
  objective: string;

  // Budget
  daily_budget?: number;
  lifetime_budget?: number;
  currency: string;

  // Basic metrics
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;

  // Cost metrics
  cpm: number;
  cpc: number;
  ctr: number;
  frequency: number;

  // Conversion metrics
  website_purchase_conversions: number;
  website_purchase_value: number;
  website_content_views: number;
  cost_per_result: number;
  roas: number;

  // Creative info
  active_ad_count: number;
}

export interface ConversionAnalysis {
  current_roas: number;
  previous_roas: number;
  roas_change_pct: number;
  current_cpm: number;
  previous_cpm: number;
  cpm_change_pct: number;
  current_cpa: number;
  avg_order_value: number;
  status: 'INCREASE_BUDGET' | 'EXPAND_TARGET' | 'CHECK_CPA' | 'MAINTAIN';
  recommendation: string;
}

export interface ClickAnalysis {
  link_click_ctr: number;
  overall_ctr: number;
  ctr_gap_warning: boolean;
  current_cpc: number;
  previous_cpc: number;
  cpc_trend: 'UP' | 'DOWN' | 'STABLE';
  landing_page_view_rate: number;
  landing_status: 'GOOD' | 'WARNING' | 'CRITICAL';
  recommendation: string;
}

export interface ImpressionAnalysis {
  current_frequency: number;
  frequency_warning: boolean;
  cpm_trend: 'UP' | 'DOWN' | 'STABLE';
  ctr_trend: 'UP' | 'DOWN' | 'STABLE';
  fatigue_detected: boolean;
  weekly_cpc_trend: number[];  // 4 weeks
  cpc_upward_trend: boolean;
  recommendation: string;
}

export interface CreativeAnalysis {
  active_ad_count: number;
  total_ad_count: number;
  diversity_score: number;  // 0-100
  creative_performances: Array<{
    ad_id: string;
    ad_name: string;
    status: string;
    ctr: number;
    cpc: number;
    spend: number;
    trend: 'IMPROVING' | 'DECLINING' | 'STABLE';
  }>;
  recommendation: string;
}

export interface PerformanceFeedback {
  campaign_id: string;
  campaign_name?: string;
  currency?: string;
  period?: { current: string; previous: string };
  current_metrics?: Record<string, number>;
  previous_metrics?: Record<string, number>;
  changes?: Record<string, number | null>;
  conversion_analysis: ConversionAnalysis;
  click_analysis: ClickAnalysis;
  impression_analysis: ImpressionAnalysis;
  creative_analysis?: CreativeAnalysis;
  creative_fatigue_analysis?: any;
  recommendations?: string[];
  risk_level?: 'LOW' | 'MEDIUM' | 'HIGH';
}

// Status filter type for campaign list
export type CampaignStatusFilter = 'ALL' | 'ACTIVE' | 'PAUSED' | 'PENDING_REVIEW' | 'ARCHIVED';

// Chat types
export interface ChatResponse {
  reply: string;
  suggested_questions: string[];
}
