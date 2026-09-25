import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Toasts } from "./components/ui";
import Estimate from "./pages/Estimate";
import NotFound from "./pages/NotFound";

const Market = lazy(() => import("./pages/Market"));
const Model = lazy(() => import("./pages/Model"));
const Offer = lazy(() => import("./pages/Offer"));
const Report = lazy(() => import("./pages/Report"));

function ScrollTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => { if (!hash) window.scrollTo(0, 0); }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollTop />
      <Suspense fallback={<div className="wrap" style={{ padding: 60 }}><span className="spinner" /></div>}>
        <Routes>
          <Route path="/" element={<Estimate />} />
          <Route path="/market" element={<Market />} />
          <Route path="/model" element={<Model />} />
          <Route path="/offer" element={<Offer />} />
          <Route path="/r/:id" element={<Report />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <Toasts />
    </>
  );
}
