import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import SignalsList from "@/pages/SignalsList";
import SignalDetail from "@/pages/SignalDetail";
import ContactsList from "@/pages/ContactsList";
import Settings from "@/pages/Settings";
import HowItWorks from "@/pages/HowItWorks";
import PappersDashboard from "@/pages/PappersDashboard";
import PappersQueries from "@/pages/PappersQueries";
import EventsCalendar from "@/pages/EventsCalendar";
import EventDetail from "@/pages/EventDetail";
import EventForm from "@/pages/EventForm";
import EventsScanner from "@/pages/EventsScanner";
import AdminOrders from "@/pages/AdminOrders";
import AdminProducts from "@/pages/AdminProducts";
import AdminClients from "@/pages/AdminClients";
import EngagersScraps from "@/pages/EngagersScraps";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            {/* Scanner Actu */}
            <Route path="/signals" element={<SignalsList />} />
            <Route path="/signals/:id" element={<SignalDetail />} />
            <Route path="/contacts" element={<ContactsList />} />
            {/* Scanner Pappers */}
            <Route path="/pappers" element={<PappersDashboard />} />
            <Route path="/pappers/queries" element={<PappersQueries />} />
            {/* Scraps Engagers */}
            <Route path="/engagers" element={<EngagersScraps />} />
            {/* CRM Événements */}
            <Route path="/events" element={<EventsCalendar />} />
            <Route path="/events/new" element={<EventForm />} />
            <Route path="/events/scanner" element={<EventsScanner />} />
            <Route path="/events/:id" element={<EventDetail />} />
            {/* Admin Commandes */}
            <Route path="/admin/orders" element={<AdminOrders />} />
            <Route path="/admin/products" element={<AdminProducts />} />
            <Route path="/admin/clients" element={<AdminClients />} />
            {/* Settings */}
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
