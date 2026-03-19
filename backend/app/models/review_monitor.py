"""리뷰 모니터링 제품 등록 모델."""
from sqlalchemy import Column, String, Integer, DateTime, Text
from sqlalchemy.sql import func
from app.db.database import Base


class MonitoredProduct(Base):
    """리뷰 모니터링 대상 제품"""
    __tablename__ = "monitored_products"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    product_name = Column(String, nullable=False)
    product_url = Column(Text, nullable=False)  # 네이버 쇼핑 제품 URL
    product_id = Column(String, nullable=True)  # 네이버 제품 ID (URL에서 추출)
    mall_name = Column(String, nullable=True)
    image_url = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
