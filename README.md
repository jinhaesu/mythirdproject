# Meta-Commander

AI-Powered Meta Marketing Platform - Meta(Facebook, Instagram) 기반 마케팅 전 주기 자동화 SaaS

## Overview

Meta-Commander는 **시장 분석(Benchmarking) → 기획(Strategy) → 제작(Creation) → 집행(Execution) → 성과 분석(Analytics)**의 마케팅 전 주기를 AI로 자동화하는 웹 플랫폼입니다.

### 핵심 기능

1. **TAB 1: Market Intelligence** - 경쟁사/키워드 모니터링, AI 요약 분석, 레퍼런스 역설계
2. **TAB 2: Creative Studio** - AI 이미지/영상 생성, 텍스트 재작성, 배경 확장
3. **TAB 3: Ads Controller** - 캠페인 설정, AI 전략 추천, Meta 발행
4. **TAB 4: Performance Dashboard** - KPI 분석, A/B 테스트 비교, AI 인사이트

## Tech Stack

### Backend
- **Framework:** FastAPI (Python 3.11+)
- **Database:** PostgreSQL, Pinecone (Vector DB)
- **AI:** Claude (Anthropic), GPT-4 Vision (OpenAI), Stable Diffusion (Replicate)

### Frontend
- **Framework:** Next.js 14 (React 18)
- **Styling:** Tailwind CSS
- **State:** Zustand, TanStack Query

### APIs
- Meta Graph API (Instagram/Facebook organic content)
- Meta Marketing API (Ads management)
- Meta Business Discovery API (Competitor analysis)

## Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL 15+
- API Keys: Meta, Anthropic, OpenAI, Replicate, Pinecone

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment file
cp .env.example .env
# Edit .env with your API keys

# Run migrations (first time)
# alembic upgrade head

# Start server
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Visit http://localhost:3000

## Project Structure

```
meta-commander/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/    # API endpoints
│   │   ├── core/                # Config, security
│   │   ├── db/                  # Database setup
│   │   ├── models/              # SQLAlchemy models
│   │   ├── schemas/             # Pydantic schemas
│   │   ├── services/            # Business logic
│   │   │   ├── ai/              # AI services
│   │   │   └── meta/            # Meta API clients
│   │   └── main.py              # FastAPI app
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── app/                 # Next.js app router
│   │   ├── components/          # React components
│   │   │   ├── tabs/            # Tab views
│   │   │   ├── ui/              # UI components
│   │   │   └── layout/          # Layout components
│   │   ├── lib/                 # API client
│   │   ├── store/               # Zustand stores
│   │   └── types/               # TypeScript types
│   └── package.json
│
└── README.md
```

## API Documentation

After starting the backend, visit:
- Swagger UI: http://localhost:8000/api/docs
- ReDoc: http://localhost:8000/api/redoc

## Data Flow

1. **Input:** User uploads competitor URL + product image
2. **Analysis:** Vision AI extracts visual style, LLM analyzes tone & manner
3. **Generation:** AI creates branded content matching competitor style
4. **Strategy:** AI recommends budget allocation and targeting
5. **Execution:** One-click publish to Meta Ads
6. **Feedback:** AI monitors performance and suggests optimizations

## Environment Variables

### Backend (.env)
```
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/meta_commander
META_APP_ID=your_app_id
META_APP_SECRET=your_app_secret
META_ACCESS_TOKEN=your_access_token
ANTHROPIC_API_KEY=your_anthropic_key
OPENAI_API_KEY=your_openai_key
REPLICATE_API_TOKEN=your_replicate_token
PINECONE_API_KEY=your_pinecone_key
JWT_SECRET_KEY=your_jwt_secret
```

### Frontend
```
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

## License

Private - All rights reserved
