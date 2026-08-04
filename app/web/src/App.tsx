import { Routes, Route } from 'react-router-dom';
import { ChatProvider } from './context/ChatContext';
import { DirectionProvider } from './context/DirectionContext';
import PaperList from './pages/PaperList';
import PaperReader from './pages/PaperReader';
import GlobalChat from './pages/GlobalChat';
import ResearchPage from './pages/ResearchPage';

export default function App() {
  return (
    <DirectionProvider>
      <ChatProvider>
        <Routes>
          <Route path="/" element={<PaperList />} />
          <Route path="/paper/:id" element={<PaperReader />} />
          <Route path="/chat" element={<GlobalChat />} />
          <Route path="/research" element={<ResearchPage />} />
        </Routes>
      </ChatProvider>
    </DirectionProvider>
  );
}
