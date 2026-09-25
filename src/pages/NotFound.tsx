import { Link } from "react-router-dom";
import { Footer, Nav } from "../components/ui";

export default function NotFound() {
  return (
    <>
      <Nav />
      <section className="section">
        <div className="wrap">
          <span className="label"><span className="index">404</span></span>
          <h1 className="display" style={{ marginTop: 16 }}>Not here<span className="q">.</span></h1>
          <p className="lead">This page doesn't exist. The estimate you're after is one click away.</p>
          <Link className="btn btn--red" to="/">Estimate a salary <span className="arrow">→</span></Link>
        </div>
      </section>
      <Footer />
    </>
  );
}
