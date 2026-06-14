import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Upload from './pages/Upload'
import Overview from './pages/Overview'
import Chat from './pages/Chat'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Upload />} />
        <Route path="/overview/:meetingId" element={<Overview />} />
        <Route path="/chat/:meetingId" element={<Chat />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
