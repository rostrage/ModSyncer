import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import { Link, useLocation } from "react-router-dom";
import icon from '../../assets/icon.svg';
import './App.css';
import Download from './routes/download';
import Share from './routes/share';

const Hello = () => {
  return (
    <div>
      <button type="button"><Link key="download" to="/download">Download a mod list.</Link></button>
      <button type="button"><Link key="share" to="/share">Share a mod list.</Link></button>
    </div>
  );
};

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Hello />} />
        <Route path="/download" element={<Download />} />
        <Route path="/share" element={<Share />} />
      </Routes>
    </Router>
  );
}
