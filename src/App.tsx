import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LoadingPage } from "@/components/LoadingSpinner";

// Lazy loading des pages pour améliorer les performances
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const SignalsPresseDashboard = lazy(() => import("@/pages/SignalsPresseDashboard"));
const SignalsPresseList = lazy(() => import("@/pages/SignalsPresseList"));
const SignalDetail = lazy(() => import("@/pages/SignalDetail"));
const ContactsList = lazy(() => import("@/pages/ContactsList"));
const Settings = lazy(() => import("@/pages/Settings"));

const HowItWorks = lazy(() => import("@/pages/HowItWorks"));
const Documentation = lazy(() => import("@/pages/Documentation"));
const PappersDashboard = lazy(() => import("@/pages/PappersDashboard"));
const PappersSignalsList = lazy(() => import("@/pages/PappersSignalsList"));

const PappersSignalDetail = lazy(() => import("@/pages/PappersSignalDetail"));
const LinkedInDashboard = lazy(() => import("@/pages/LinkedInDashboard"));
const LinkedInEngagers = lazy(() => import("@/pages/LinkedInEngagers"));
const SignalsLinkedInList = lazy(() => import("@/pages/SignalsLinkedInList"));
const EventsCalendar = lazy(() => import("@/pages/EventsCalendar"));
const EventDetail = lazy(() => import("@/pages/EventDetail"));
const EventForm = lazy(() => import("@/pages/EventForm"));
const SalonMariage = lazy(() => import("@/pages/SalonMariage"));

const AdminOrders = lazy(() => import("@/pages/AdminOrders"));
const AdminProducts = lazy(() => import("@/pages/AdminProducts"));
const AdminClients = lazy(() => import("@/pages/AdminClients"));
const PartnersList = lazy(() => import("@/pages/PartnersList"));
const PartnerDetail = lazy(() => import("@/pages/PartnerDetail"));
const PresentationsList = lazy(() => import("@/pages/PresentationsList"));
const PresentationViewer = lazy(() => import("@/pages/PresentationViewer"));
const NotFound = lazy(() => import("@/pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<LoadingPage />}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              {/* Signaux Presse */}
              <Route path="/signals" element={<SignalsPresseDashboard />} />
              <Route path="/signals/list" element={<SignalsPresseList />} />
              <Route path="/signals/:id" element={<SignalDetail />} />
              {/* Signaux Pappers */}
              <Route path="/pappers" element={<PappersDashboard />} />
              <Route path="/pappers/list" element={<PappersSignalsList />} />
              
              <Route path="/pappers/:id" element={<PappersSignalDetail />} />
              {/* Signaux LinkedIn */}
              <Route path="/engagers" element={<LinkedInDashboard />} />
              <Route path="/engagers/list" element={<LinkedInEngagers />} />
              <Route path="/engagers/signals" element={<SignalsLinkedInList />} />
              {/* Contacts */}
              <Route path="/contacts" element={<ContactsList />} />
              {/* CRM Événements */}
              <Route path="/events" element={<EventsCalendar />} />
              <Route path="/events/new" element={<EventForm />} />
              <Route path="/salon-mariage" element={<SalonMariage />} />
              
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
              
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
