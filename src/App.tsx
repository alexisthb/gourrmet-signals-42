import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LoadingPage } from "@/components/LoadingSpinner";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";

// Auth page (not lazy loaded for faster initial auth check)
import Auth from "@/pages/Auth";
import Unsubscribe from "@/pages/Unsubscribe";

// Lazy loading des pages pour améliorer les performances.
// Auto-reload quand un chunk est périmé (nouveau déploiement) pour éviter l'écran blanc.
const lazyWithRetry = <T extends { default: React.ComponentType<any> }>(
  factory: () => Promise<T>
) =>
  lazy(async () => {
    try {
      return await factory();
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (
        msg.includes("Failed to fetch dynamically imported module") ||
        msg.includes("Importing a module script failed") ||
        msg.includes("error loading dynamically imported module")
      ) {
        const key = "__chunk_reload__";
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          window.location.reload();
          return new Promise<T>(() => {});
        }
      }
      throw err;
    }
  });

const Dashboard = lazyWithRetry(() => import("@/pages/Dashboard"));
const SignalsPresseDashboard = lazyWithRetry(() => import("@/pages/SignalsPresseDashboard"));
const SignalsPresseList = lazyWithRetry(() => import("@/pages/SignalsPresseList"));
const SignalDetail = lazyWithRetry(() => import("@/pages/SignalDetail"));
const ContactsList = lazyWithRetry(() => import("@/pages/ContactsList"));
const Settings = lazyWithRetry(() => import("@/pages/Settings"));

const HowItWorks = lazyWithRetry(() => import("@/pages/HowItWorks"));
const Documentation = lazyWithRetry(() => import("@/pages/Documentation"));
const PappersDashboard = lazyWithRetry(() => import("@/pages/PappersDashboard"));
const PappersSignalsList = lazyWithRetry(() => import("@/pages/PappersSignalsList"));

const PappersSignalDetail = lazyWithRetry(() => import("@/pages/PappersSignalDetail"));
const LinkedInDashboard = lazyWithRetry(() => import("@/pages/LinkedInDashboard"));
const LinkedInEngagers = lazyWithRetry(() => import("@/pages/LinkedInEngagers"));
const SignalsLinkedInList = lazyWithRetry(() => import("@/pages/SignalsLinkedInList"));
const EventsCalendar = lazyWithRetry(() => import("@/pages/EventsCalendar"));
const EventDetail = lazyWithRetry(() => import("@/pages/EventDetail"));
const EventForm = lazyWithRetry(() => import("@/pages/EventForm"));
const EventContactsList = lazyWithRetry(() => import("@/pages/EventContactsList"));
const SalonMariage = lazyWithRetry(() => import("@/pages/SalonMariage"));

const PartnersList = lazyWithRetry(() => import("@/pages/PartnersList"));
const PartnerDetail = lazyWithRetry(() => import("@/pages/PartnerDetail"));
const PresentationsList = lazyWithRetry(() => import("@/pages/PresentationsList"));
const PresentationViewer = lazyWithRetry(() => import("@/pages/PresentationViewer"));
const Pipeline = lazyWithRetry(() => import("@/pages/Pipeline"));
const SignalsProblemes = lazyWithRetry(() => import("@/pages/SignalsProblemes"));
const NotFound = lazyWithRetry(() => import("@/pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<LoadingPage />}>
            <Routes>
              {/* Public route - Auth page */}
              <Route path="/auth" element={<Auth />} />
              <Route path="/unsubscribe" element={<Unsubscribe />} />
              
              
              {/* Protected routes - require authentication */}
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/pipeline" element={<Pipeline />} />
                  <Route path="/problemes" element={<SignalsProblemes />} />
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
                  <Route path="/events/contacts" element={<EventContactsList />} />
                  <Route path="/salon-mariage" element={<SalonMariage />} />
                  
                  <Route path="/events/:id/edit" element={<EventForm />} />
                  <Route path="/events/:id" element={<EventDetail />} />
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
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
