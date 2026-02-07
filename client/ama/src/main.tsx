import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import { FavoritesProvider } from "@/context/FavoritesContext";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./index.css";
import App from "./App.tsx";
import { AuthProvider } from "./context/AuthContext.tsx";
import { LanguageProvider } from "./context/LanguageContext";
import i18n from "./i18n";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <I18nextProvider i18n={i18n}>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AuthProvider>
          <FavoritesProvider>
            <CartProvider>
              <BrowserRouter>
                <SpeedInsights />
                <App />
              </BrowserRouter>
            </CartProvider>
          </FavoritesProvider>
        </AuthProvider>
      </LanguageProvider>
    </QueryClientProvider>
  </I18nextProvider>
);
