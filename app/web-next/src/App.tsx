import { Routes, Route } from 'react-router-dom';
import { ChatProvider } from './context/ChatContext';
import { DirectionProvider } from './context/DirectionContext';
import HomePage from './pages/HomePage';
import PaperList from './pages/PaperList';
import PaperReader from './pages/PaperReader';
import GlobalChat from './pages/GlobalChat';
import SciversePage from './pages/SciversePage';
import ResearchPage from './pages/ResearchPage';
import BrowsePage from './pages/BrowsePage';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <DirectionProvider>
      <ChatProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/papers" element={<PaperList />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/paper/:id" element={<PaperReader />} />
          <Route path="/chat" element={<GlobalChat />} />
          <Route path="/sciverse" element={<SciversePage />} />
          <Route path="/research" element={<ResearchPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ChatProvider>
    </DirectionProvider>
  );
}
