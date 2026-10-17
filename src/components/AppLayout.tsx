import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar.tsx';
import { Header } from './Header.tsx';
import { useStatus } from '../hooks/useStatus.ts';

export const AppLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { status, isBackendConnected } = useStatus();

  // Page titles depending on route
  const getPageInfo = () => {
    const path = location.pathname;
    if (path === '/') return { title: 'COMMAND DASHBOARD', subtitle: 'Tactical Status & Neural Operations' };
    if (path.startsWith('/chat')) return { title: 'NEURAL CHAT', subtitle: 'Bounded Context Intelligence' };
    if (path === '/history') return { title: 'MEMORY LOGS', subtitle: 'Persistent SQLite Archives' };
    if (path === '/settings') return { title: 'SYSTEM CONFIG', subtitle: 'Runtime Parameters & Diagnostics' };
    if (path === '/about') return { title: 'ABOUT EDITH', subtitle: 'Core Architecture & Roadmap' };
    return { title: 'EDITH AI OS', subtitle: 'Enhanced Digital Intelligence' };
  };

  const { title, subtitle } = getPageInfo();

  return (
    <div className="min-h-screen bg-[#05080F] text-[#E6F1FF] flex">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <Header
          title={title}
          subtitle={subtitle}
          status={status}
          isBackendConnected={isBackendConnected}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        />

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
