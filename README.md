# 🌍 Climate Intelligence Platform

<div align="center">

**AI-Powered Global Climate Monitoring Dashboard**

[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-0.166-white?style=for-the-badge&logo=three.js)](https://threejs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.112-green?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

Real-time global climate monitoring powered by Python, Artificial Intelligence, satellite observations, and interactive 3D visualization.

[Demo](#) • [Documentation](#documentation) • [API Reference](#api-reference) • [Contributing](#contributing)

</div>

---

## 📖 Overview

Climate Intelligence Platform is a premium web application designed for real-time monitoring of Earth's climate systems. Inspired by professional intelligence centers like NASA Mission Control and Bloomberg Terminal, it provides scientists, researchers, governments, and journalists with an interactive, AI-powered system for understanding our planet's changing climate.

### ✨ Key Features

- **🌐 Interactive 3D Earth Globe** - Full-screen WebGL rendering inspired by Altis.to with minimal UI overlay
- **📊 Real-time Climate Data** - Live KPI metrics including temperature, CO₂ levels, methane concentrations, sea level rise, and more
- **🔥 Live Event Feed** - Global climate events monitoring (wildfires, cyclones, volcanic activity, extreme weather)
- **🤖 AI-Powered Analytics** - Machine learning predictions for temperature trends, wildfire risks, flood probabilities, and more
- **📈 Interactive Charts** - Historical climate data visualization with Plotly.js
- **🎨 Altis-Style Interface** - Minimalist design with collapsible side panels and glassmorphism effects
- **🌙 Dark Theme** - Pure black background optimized for data visualization
- **🚀 High Performance** - Built with Next.js 14, React Three Fiber, and Deck.gl for large datasets

---

## 🎯 Design Philosophy

The platform combines the design quality of premium products:

- **Altis.to** - Full-screen 3D globe with minimal UI overlay and collapsible side panels
- **Apple Human Interface Design** - Clean typography and intuitive interactions
- **Stripe Dashboard** - Sophisticated data visualization patterns
- **Linear** - Minimalist aesthetics with subtle animations
- **Bloomberg Terminal** - Professional data density and layout
- **NASA Mission Control** - Real-time monitoring interface
- **Glassmorphism** - Modern frosted glass effects with backdrop blur

### Color Palette

```css
Background:    #000000 (Pure black for full-screen experience)
Surface:       rgba(20, 20, 20, 0.8)
Borders:       rgba(255,255,255,0.1)
Primary Text:  #ffffff
Secondary:     rgba(255, 255, 255, 0.6)
Accent Blue:   #1e5a4a
Accent Cyan:   #2d7a6a
Success:       #28E08F
Warning:       #FFB648
Danger:        #FF5D6C
```

---

## 🚀 Tech Stack

### Frontend
- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript 5.5
- **Styling**: TailwindCSS 3.4
- **3D Graphics**: Three.js 0.166, React Three Fiber 8.16, Drei 9.108
- **Big Data Visualization**: Deck.gl 9.0 (for large-scale climate data)
- **Charts**: Plotly.js 2.29
- **Animations**: Framer Motion 11.3
- **State Management**: React Query 5.51
- **Icons**: Lucide React 0.424
- **HTTP Client**: Axios 1.7

### Backend
- **Framework**: FastAPI 0.112
- **Language**: Python 3.10+
- **Validation**: Pydantic 2.8
- **Server**: Uvicorn 0.30
- **HTTP Client**: httpx 0.27

### Future Integrations
- **Databases**: PostgreSQL with PostGIS, Redis
- **Task Queue**: Celery
- **Data Processing**: Pandas, Polars, NumPy, GeoPandas
- **Geospatial**: Xarray, Rasterio, Shapely
- **AI/ML**: OpenAI, Claude, Gemini, Local LLM support

---

## 📁 Project Structure

```
climate-intelligence/
├── frontend/                    # Next.js frontend application
│   ├── app/                   # Next.js App Router
│   │   ├── page.tsx          # Homepage with 3D globe
│   │   ├── dashboard/        # Dashboard page
│   │   ├── analytics/        # Analytics page
│   │   ├── predictions/      # AI predictions page
│   │   ├── layout.tsx        # Root layout
│   │   └── globals.css       # Global styles
│   ├── components/           # React components
│   │   ├── SideNavigation.tsx  # Collapsible side navigation (Altis-style)
│   │   ├── AltisEarthGlobe.tsx # Full-screen 3D globe
│   │   ├── LeftPanel.tsx      # Collapsible climate metrics panel
│   │   ├── RightPanel.tsx     # Collapsible events panel
│   │   ├── DeckGlobe.tsx      # Deck.gl visualization (for big data)
│   │   ├── Navigation.tsx   # Main navigation
│   │   ├── HeroSection.tsx  # Homepage hero
│   │   ├── EarthGlobe.tsx   # 3D Earth with shaders
│   │   ├── KPICards.tsx     # KPI metrics
│   │   ├── LiveEventFeed.tsx # Live events
│   │   ├── AIClimateSummary.tsx # AI summary
│   │   ├── AnalyticsCharts.tsx # Interactive charts
│   │   ├── AIAssistant.tsx  # Chat widget
│   │   └── AIPredictions.tsx # AI predictions
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   └── next.config.js
├── backend/                   # FastAPI backend
│   ├── main.py              # Main application (REST API)
│   ├── data_sources.py      # Live data adapters (Open-Meteo, NASA, NOAA, NSIDC)
│   └── requirements.txt
├── README.md                 # This file
├── AGENTS.md                # Technical documentation
└── .gitignore
```

---

## 🛠️ Installation

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+
- **Git**

### Frontend Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/climate-intelligence.git
cd climate-intelligence/frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Frontend will be available at `http://localhost:3000`

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On Linux/Mac:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start server
python main.py
```

Backend API will be available at `http://localhost:8000`

API Documentation: `http://localhost:8000/docs`

---

## � Usage

### Main Features

#### 1. **Full-Screen 3D Globe (Altis-style)**
- **Controls**:
  - Scroll to zoom
  - Left click + drag to spin
  - Right click + drag to rotate
- **Features**:
  - Full-screen immersive experience
  - Atmospheric glow effects
  - Collapsible side panels
  - Minimal UI overlay
  - Pure black background

#### 2. **Collapsible Side Panels**
- **Left Panel**: Climate metrics (temperature, CO₂, methane)
- **Right Panel**: Live climate events feed
- **Side Navigation**: Collapsible menu for different views
- **Glassmorphism Effects**: Frosted glass with backdrop blur

#### 3. **Dashboard**
- 6 animated KPI cards with AI insights
- Live event feed with global climate events
- AI-generated climate summary
- Real-time data updates

#### 4. **Analytics**
- Interactive Plotly charts
- Multiple climate metrics visualization
- Historical data trends (1880–Present)
- Export capabilities

#### 5. **AI Predictions**
- AI-generated forecasts
- Probability scores and confidence intervals
- Risk level assessments
- Multiple timeframe options (7 days, 30 days, 90 days, 1 year)

#### 6. **Big Data Visualization (Deck.gl)**
- High-performance rendering of millions of data points
- Heatmap layers for climate patterns
- Scatterplot layers for events
- Arc layers for movement tracks
- Optimized for large-scale climate datasets

---

## 🔌 API Reference

### Endpoints

#### Health Check
```http
GET /api/health
```

#### Weather & Forecast (Open-Meteo)
```http
GET /api/weather?lat=50.45&lon=30.52
```
Current conditions + 7-day forecast: temperature, humidity, wind, pressure, cloud cover.

#### Marine / Ocean (Open-Meteo Marine)
```http
GET /api/marine?lat=25&lon=-80
```
Sea surface temperature, wave height, wave period, wave direction.

#### Air Quality (Open-Meteo)
```http
GET /api/air-quality?lat=50.45&lon=30.52
```
US AQI, PM2.5, PM10, ozone, NO₂, CO.

#### Global Temperature Anomaly (NASA GISTEMP)
```http
GET /api/gistemp
```
Monthly/annual global anomaly since 1880 (1951–1980 baseline).

#### CO₂ Concentration (NOAA GML)
```http
GET /api/co2
```
Global monthly mean CO₂ since 1958.

#### Arctic Sea Ice (NSIDC)
```http
GET /api/sea-ice
```
Daily extent, anomaly vs 1981–2010, annual September minimum.

#### Tropical Cyclones (NOAA NHC)
```http
GET /api/hurricanes
```
Active storms in the Atlantic basin.

#### Fires (NASA FIRMS)
```http
GET /api/fires?days=1
```
Active hotspots. Requires `FIRMS_API_KEY` in `backend/.env`; falls back to simulated data.

#### Consolidated Overview
```http
GET /api/overview?lat=50.45&lon=30.52
```
Single aggregated snapshot for the mission-control dashboard.

#### KPI Metrics
```http
GET /api/kpi
```
Real KPI values derived from the live sources above.

#### Climate Events
```http
GET /api/events
```
Returns current global climate events with coordinates for the 3D globe.

#### AI Predictions
```http
GET /api/predictions
```
Returns AI-generated climate predictions driven by live data.

#### AI Summary
```http
GET /api/ai-summary
```
Returns AI-generated climate summary.

### Response Example

```json
{
  "name": "Global Temperature",
  "value": "+1.54°C",
  "trend": "+0.12°C",
  "trend_up": true,
  "insight": "Temperature anomaly continues upward trend"
}
```

---

## 📊 Data Sources

Live data is fetched by the backend (`backend/data_sources.py`) from these public providers:

| Module | Primary source | No key needed |
|--------|---------------|---------------|
| Weather / forecast | Open-Meteo | ✅ |
| Ocean (SST, waves) | Open-Meteo Marine | ✅ |
| Air quality | Open-Meteo Air Quality | ✅ |
| Global warming trend | NASA GISTEMP (CSV) | ✅ |
| CO₂ concentration | NOAA GML (CSV) | ✅ |
| Sea ice | NSIDC Sea Ice Index v4 | ✅ |
| Hurricanes | NOAA NHC (RSS) | ✅ |
| Wildfires | NASA FIRMS | ⚠️ needs `FIRMS_API_KEY` |

Responses are cached in-memory (weather 10 min, slow datasets 6 h). If a provider is
unreachable or no API key is configured, the backend degrades gracefully to cached or
fallback data so the dashboard always renders.

---

## 🎨 Components

### EarthGlobe
Custom WebGL shaders for realistic Earth rendering:
- Vertex/Fragment shaders for day/night cycle
- Atmospheric scattering simulation
- City lights on night side
- Real-time sun position calculation

### KPICards
Animated metric cards with:
- Real-time data updates
- Mini trend charts
- AI-generated insights
- Color-coded risk levels

### AnalyticsCharts
Interactive Plotly visualizations:
- Zoom and pan capabilities
- Time range selection
- Export to multiple formats
- Responsive design

### AIAssistant
Conversational interface featuring:
- Natural language processing
- Context-aware responses
- Real-time typing indicators
- Message history

---

## 🔧 Configuration

### Environment Variables

Create `.env.local` in the frontend directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_API_KEY=your_api_key_here
```

### Tailwind Configuration

Custom color palette defined in `tailwind.config.ts`:

```typescript
colors: {
  background: "#05070B",
  surface: "#10161F",
  border: "rgba(255,255,255,0.08)",
  primary: "#F5F7FA",
  secondary: "#8B9AB5",
  accent: {
    blue: "#36A3FF",
    cyan: "#29F2FF",
  },
  success: "#28E08F",
  warning: "#FFB648",
  danger: "#FF5D6C",
}
```

---

## � Deployment

### Frontend (Vercel)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Backend (Render/Railway)

```bash
# Deploy using Render
# Or configure for Railway
```

### Docker

```dockerfile
# Dockerfile for backend
FROM python:3.10-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style
- Add tests for new features
- Update documentation as needed
- Use conventional commit messages

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Three.js** - 3D graphics library
- **React Three Fiber** - React renderer for Three.js
- **Next.js** - React framework
- **FastAPI** - Modern Python web framework
- **Plotly** - Interactive charting library
- **NASA** - Climate data and imagery
- **NOAA** - Weather and climate data

---

## 📞 Support

For support, email support@climateintelligence.ai or open an issue on GitHub.

---

## 🗺️ Roadmap

### Phase 1 (Current)
- ✅ Full-screen 3D globe with Altis-style interface
- ✅ Collapsible side panels for metrics and events
- ✅ Dashboard with KPI cards
- ✅ Analytics with charts
- ✅ AI predictions
- ✅ Deck.gl integration for big data visualization
- ✅ Minimalist dark theme with pure black background

### Phase 2 (Q3 2026)
- ⏳ Real satellite data integration
- ⏳ Historical data playback
- ⏳ Regional comparison tools
- ⏳ User authentication
- ⏳ Report generation (PDF, Excel)

### Phase 3 (Q4 2026)
- ⏳ Mobile application
- ⏳ Advanced AI models
- ⏳ Real-time WebSocket updates
- ⏳ Custom alerts and notifications
- ⏳ API for third-party integration

### Phase 4 (2027)
- ⏳ Machine learning model training
- ⏳ Climate risk assessment tools
- ⏳ Integration with IoT sensors
- ⏳ Enterprise features
- ⏳ Global deployment

---

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=yourusername/climate-intelligence&type=Date)](https://star-history.com/#yourusername/climate-intelligence&Date)

---

<div align="center">

**Built with ❤️ for Earth's future**

[⬆ Back to Top](#-climate-intelligence-platform)

</div>
#   A I _ C l i m a t e _ I n t e l l i g e n c e  
 #   A I _ C l i m a t e _ I n t e l l i g e n c e  
 