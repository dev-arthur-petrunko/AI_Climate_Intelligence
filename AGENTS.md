# Climate Intelligence Platform - Project Documentation

## Project Overview
AI-Powered Global Climate Monitoring Dashboard - premium web platform for real-time global climate monitoring powered by Python, Artificial Intelligence, satellite observations, and interactive 3D visualization.

## Project Structure
```
climate-intelligence/
├── frontend/                 # Next.js frontend application
│   ├── app/                # Next.js app directory
│   │   ├── page.tsx       # Homepage with 3D globe
│   │   ├── dashboard/     # Dashboard page
│   │   ├── analytics/     # Analytics page with charts
│   │   ├── predictions/   # AI predictions page
│   │   ├── layout.tsx     # Root layout
│   │   └── globals.css    # Global styles and color palette
│   ├── components/        # React components
│   │   ├── Navigation.tsx         # Main navigation with routing
│   │   ├── HeroSection.tsx        # Homepage hero section
│   │   ├── EarthGlobe.tsx         # 3D Earth with climate layers
│   │   ├── KPICards.tsx           # KPI metrics cards
│   │   ├── LiveEventFeed.tsx      # Live climate events feed
│   │   ├── AIClimateSummary.tsx   # AI-generated climate summary
│   │   ├── AnalyticsCharts.tsx    # Interactive Plotly charts
│   │   ├── AIAnalysisPanel.tsx    # AI analysis popup panel (right side of globe)
│   │   └── AIPredictions.tsx      # AI predictions display (Groq)
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   └── next.config.js
├── backend/                # FastAPI backend
│   ├── main.py            # Main FastAPI application
│   ├── ai_groq.py         # Groq AI analysis + predictions
│   ├── analytics.py       # Statistical analytics (numpy/scipy): trends, z-scores, YoY
│   ├── db.py              # SQLAlchemy async + PostgreSQL (Neon) ClimateSnapshot
│   ├── scheduler.py       # APScheduler background jobs (hourly snapshots, cache prewarm)
│   ├── data_sources.py    # Climate data adapters (Open-Meteo, NASA, NOAA, NSIDC)
│   ├── migrations/        # Alembic migrations
│   ├── alembic.ini
│   └── requirements.txt
├── render.yaml            # Render deployment config
└── README.md
```

## Development Commands

### Frontend
```bash
cd frontend
npm install              # Install dependencies
npm run dev             # Start development server (http://localhost:3000)
npm run build           # Build for production
npm run start           # Start production server
npm run lint            # Run ESLint
```

### Backend
```bash
cd backend
python -m venv venv                   # Create virtual environment
venv\Scripts\activate                 # Activate (Windows)
source venv/bin/activate              # Activate (Linux/Mac)
pip install -r requirements.txt       # Install dependencies
python main.py                        # Start server (http://localhost:8000)
```

## Tech Stack

### Frontend
- **Framework**: Next.js 14 with TypeScript
- **Styling**: TailwindCSS with custom color palette
- **3D Visualization**: Three.js, React Three Fiber, Drei
- **Animations**: Framer Motion
- **Charts**: Plotly.js (react-plotly.js)
- **State Management**: React Query
- **Icons**: Lucide React
- **Routing**: Next.js App Router

### Backend
- **Framework**: FastAPI
- **Data Validation**: Pydantic
- **HTTP Client**: httpx
- **Environment**: python-dotenv

## Color Palette
- **Background**: #05070B
- **Surface Cards**: #10161F
- **Borders**: rgba(255,255,255,0.08)
- **Primary Text**: #F5F7FA
- **Secondary Text**: #8B9AB5
- **Accent Blue**: #36A3FF
- **Accent Cyan**: #29F2FF
- **Success**: #28E08F
- **Warning**: #FFB648
- **Danger**: #FF5D6C

## Available Pages
- `/` - Homepage with 3D Earth globe
- `/dashboard` - Dashboard with KPI cards and live events
- `/analytics` - Analytics with interactive charts
- `/predictions` - AI predictions with risk assessments

## Key Features

### 3D Earth Globe
- Interactive rotation and zoom
- Multiple climate layers (temperature, CO₂, methane, wildfires, ice, rainfall, wind, pollution)
- Atmospheric glow effects
- Cloud layer simulation
- Star field background

### Dashboard
- 6 animated KPI cards with AI insights
- Live event feed with global climate events
- AI-generated climate summary
- Real-time data updates

### Analytics
- Interactive Plotly charts
- Multiple climate metrics visualization
- Historical data trends
- Export capabilities

### AI Predictions
- Groq-powered AI forecasts (llama-3.3-70b-versatile)
- Probability scores and confidence intervals
- Risk level assessments
- Multiple timeframe options (7 days, 30 days, 90 days, 1 year)

### AI Analysis Panel
- Separate window popping up on the right side of the 3D globe
- AI analysis of today's climate situation (AI Groq)
- Regenerated twice a day at 09:00 and 17:00 Kyiv time
- Generated in the selected UI language (en/uk/de/pl/fr/it/ka)
- Collapsible, refreshable, links to the predictions page

## API Endpoints (Backend)
- `GET /` - API information
- `GET /api/health` - Health check
- `GET /api/kpi` - Climate KPI metrics
- `GET /api/events` - Current climate events
- `GET /api/predictions` - AI-generated predictions (AI Groq)
- `GET /api/ai-analysis` - Today's AI climate analysis (Groq, 09:00 & 17:00 Kyiv, per language)
- `GET /api/ai-summary` - AI climate summary
- `GET /api/overview?lat=..&lon=..` - Aggregated snapshot
- `GET /api/weather?lat=..&lon=..` - Weather + forecast (Open-Meteo)
- `GET /api/marine?lat=..&lon=..` - SST + waves (Open-Meteo Marine)
- `GET /api/air-quality?lat=..&lon=..` - Air quality (Open-Meteo)
- `GET /api/gistemp` - Temperature anomaly (NASA GISTEMP)
- `GET /api/co2` - CO₂ concentration (NOAA GML)
- `GET /api/sea-ice` - Arctic sea ice (NSIDC)
- `GET /api/sea-ice-south` - Antarctic sea ice (NSIDC)
- `GET /api/sea-level` - Global sea level (Church & White + UHSLC)
- `GET /api/ocean-heat` - Ocean heat content (NOAA GML)
- `GET /api/ocean-ph` - Ocean acidification pH (NOAA/OWID)
- `GET /api/hurricanes` - Tropical cyclones (NOAA NHC)
- `GET /api/fires?days=1` - Fire hotspots (NASA FIRMS, needs key)
- `GET /api/db-status` - Database connectivity + snapshot status

## Data Endpoints (Enriched)
- `GET /api/gistemp` / `co2` / `sea-level` / `ocean-heat` / `ocean-ph` — each returns an extra `analysis` field: `trend_analysis` (slope/year, R², p-value, projection), `z_score_anomaly`, `year_over_year`
- `GET /api/sea-ice` / `sea-ice-south` — analysis computed over `annual_minimum` series

## Design Philosophy
- Premium dark theme with futuristic appearance
- Glassmorphism effects
- Smooth animations and transitions
- Premium spacing and typography
- Subtle glow effects
- Responsive design

## Component Patterns

### Glassmorphism
```css
.glass {
  background: rgba(16, 22, 31, 0.6);
  backdrop-filter: blur(20px);
  border: 1px solid var(--border);
  border-radius: 16px;
}
```

### Gradient Text
```css
.text-gradient {
  background: linear-gradient(135deg, var(--accent-blue), var(--accent-cyan));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

## Future Enhancements
- Integration with real satellite data APIs
- Advanced 3D Earth textures (satellite imagery)
- Historical data playback
- Regional comparison tools
- Report generation (PDF, Excel, PowerPoint)
- Data export capabilities
- Enhanced AI models integration
- Real-time WebSocket updates
- Mobile app development

## Data Sources (Planned Integration)
- NASA
- NOAA
- Copernicus
- ECMWF
- ESA
- World Meteorological Organization (WMO)
- Berkeley Earth
- Global Carbon Project
- MODIS Fire Data
- Sentinel
- Landsat
- ERA5

## Build Status
- ✅ Frontend structure complete
- ✅ Backend API basic implementation
- ✅ 3D Earth globe with climate layers (real events only: FIRMS fires + NOAA cyclones + ocean indicators)
- ✅ Dashboard with KPI cards
- ✅ Analytics with interactive charts
- ✅ AI predictions page
- ✅ AI analysis panel (Groq, 09:00 & 17:00 Kyiv, per language)
- ✅ Navigation with routing
- ✅ Responsive design
- ✅ Statistical analytics module (numpy/scipy): trends, z-scores, YoY on enriched endpoints
- ✅ PostgreSQL (Neon) via SQLAlchemy async + Alembic migrations + APScheduler snapshots
- ✅ Deployment config (render.yaml, PORT/CORS_ORIGINS from env)
- ⏳ Real data integration
- ⏳ Report generation

## Deployment (Render + Vercel)
- Backend deployed to Render; port comes from `$PORT`, CORS from `CORS_ORIGINS`.
- Frontend on Vercel uses `NEXT_PUBLIC_API_URL=https://<your-app>.onrender.com` env var (no code change needed).
- Required env vars on Render: `GROQ_API_KEY`, `FIRMS_API_KEY`, `DATABASE_URL` (Neon), `CORS_ORIGINS`.
- DB migration: `cd backend && alembic upgrade head` (requires `DATABASE_URL`).

## Environment Variables
- `PORT` — server port (Render sets it automatically; local default 8000)
- `CORS_ORIGINS` — comma-separated allowed origins (default: localhost:3000)
- `DATABASE_URL` — Neon Postgres connection string (optional locally)
- `DATABASE_POOL_SIZE` — asyncpg pool size (default 5)
- `GROQ_API_KEY` / `GROQ_MODEL` — Groq AI (model default llama-3.3-70b-versatile)
- `FIRMS_API_KEY` — NASA FIRMS live fire hotspots
- `NEXT_PUBLIC_API_URL` — frontend → backend base URL

## Notes for Future Development
1. When adding new pages, update Navigation.tsx navItems array
2. Follow the established color palette in tailwind.config.ts
3. Use glassmorphism components for consistent UI
4. Implement loading states for async operations
5. Add error boundaries for better error handling
6. Consider implementing caching for API responses
7. Add unit tests for critical components
8. Optimize 3D rendering performance
9. Implement proper TypeScript types
10. Add accessibility features (ARIA labels, keyboard navigation)
