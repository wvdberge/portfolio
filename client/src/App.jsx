import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './components/Dashboard.jsx';
import AssetsView from './components/AssetsView.jsx';
import AssetDetail from './components/AssetDetail.jsx';
import LiabilitiesView from './components/LiabilitiesView.jsx';
import LiabilityDetail from './components/LiabilityDetail.jsx';
import DataEntry from './components/DataEntry.jsx';
import YearlySummary from './components/YearlySummary.jsx';
import ImportPage from './components/ImportPage.jsx';

function Nav() {
  return (
    <nav className="nav">
      <span className="nav-title">Portfolio</span>
      <NavLink to="/"            end className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>Dashboard</NavLink>
      <NavLink to="/assets"          className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>Assets</NavLink>
      <NavLink to="/liabilities"     className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>Liabilities</NavLink>
      <NavLink to="/yearly"          className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>Yearly</NavLink>
      <NavLink to="/import"          className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>Import</NavLink>
      <NavLink to="/data-entry"      className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>Data Entry</NavLink>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Nav />
        <main className="main">
          <Routes>
            <Route path="/"                element={<Dashboard />} />
            <Route path="/assets"          element={<AssetsView />} />
            <Route path="/assets/:id"      element={<AssetDetail />} />
            <Route path="/liabilities"     element={<LiabilitiesView />} />
            <Route path="/liabilities/:id" element={<LiabilityDetail />} />
            <Route path="/yearly"          element={<YearlySummary />} />
            <Route path="/import"          element={<ImportPage />} />
            <Route path="/data-entry"      element={<DataEntry />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
