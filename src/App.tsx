import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import SignalsPresseDashboard from "@/pages/SignalsPresseDashboard";
import SignalsPresseList from "@/pages/SignalsPresseList";
import SignalDetail from "@/pages/SignalDetail";
import ContactsList from "@/pages/ContactsList";
import Settings from "@/pages/Settings";
import ApiSettings from "@/pages/ApiSettings";
import HowItWorks from "@/pages/HowItWorks";
import Documentation from "@/pages/Documentation";
import PappersDashboard from "@/pages/PappersDashboard";
import PappersQueries from "@/pages/PappersQueries";
import LinkedInDashboard from "@/pages/LinkedInDashboard";
import LinkedInEngagers from "@/pages/LinkedInEngagers";
import SignalsLinkedInList from "@/pages/SignalsLinkedInList";
import EventsCalendar from "@/pages/EventsCalendar";
import EventDetail from "@/pages/EventDetail";
import EventForm from "@/pages/EventForm";
import EventsScanner from "@/pages/EventsScanner";
import AdminOrders from "@/pages/AdminOrders";
import AdminProducts from "@/pages/AdminProducts";
import AdminClients from "@/pages/AdminClients";
import PartnersList from "@/pages/PartnersList";
import PartnerDetail from "@/pages/PartnerDetail";
import PresentationsList from "@/pages/PresentationsList";
import PresentationViewer from "@/pages/PresentationViewer";
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
            {/* Signaux Presse */}
            <Route path="/signals" element={<SignalsPresseDashboard />} />
            <Route path="/signals/list" element={<SignalsPresseList />} />
            <Route path="/signals/:id" element={<SignalDetail />} />
            {/* Signaux Pappers */}
            <Route path="/pappers" element={<PappersDashboard />} />
            <Route path="/pappers/queries" element={<PappersQueries />} />
            {/* Signaux LinkedIn */}
            <Route path="/engagers" element={<LinkedInDashboard />} />
            <Route path="/engagers/list" element={<LinkedInEngagers />} />
            <Route path="/engagers/signals" element={<SignalsLinkedInList />} />
            {/* Contacts */}
            <Route path="/contacts" element={<ContactsList />} />
            {/* CRM Événements */}
            <Route path="/events" element={<EventsCalendar />} />
            <Route path="/events/new" element={<EventForm />} />
            <Route path="/events/scanner" element={<EventsScanner />} />
            <Route path="/events/:id" element={<EventDetail />} />
            {/* Admin Commandes */}
            <Route path="/admin/orders" element={<AdminOrders />} />
            <Route path="/admin/products" element={<AdminProducts />} />
            <Route path="/admin/clients" element={<AdminClients />} />
            {/* Partenaires */}
            <Route path="/partners" element={<PartnersList />} />
            <Route path="/partners/:id" element={<PartnerDetail />} />
            {/* Présentations */}
            <Route path="/presentations" element={<PresentationsList />} />
            <Route path="/presentations/:id/view" element={<PresentationViewer />} />
            {/* Settings */}
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/documentation" element={<Documentation />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/api" element={<ApiSettings />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
