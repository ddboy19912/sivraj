import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AppLayout } from "@/components/app/AppLayout";
import { ThemeProvider } from "@/providers/theme-provider";

const HomeRoute = lazy(() => import("@/pages/app/HomeRoute"));
const ChatRoute = lazy(() => import("@/pages/app/ChatRoute"));
const ConsoleRoute = lazy(() => import("@/pages/app/ConsoleRoute"));

function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<RoutedPage page={<HomeRoute />} />} />
              <Route
                path="settings"
                element={<RoutedPage page={<HomeRoute />} />}
              />
              <Route
                path="chat"
                element={<RoutedPage page={<ChatRoute />} />}
              />
              <Route
                path="console"
                element={<RoutedPage page={<ConsoleRoute />} />}
              />
              <Route path="home" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function RoutedPage({ page }: { page: ReactNode }) {
  return <Suspense fallback={null}>{page}</Suspense>;
}

export default App;
