"use client";

import dynamic from "next/dynamic";

const OtthonApp = dynamic(() => import("./OtthonApp"), {
  ssr: false,
  loading: () => <main className="app-loading" aria-label="Az Otthon alkalmazás betöltése" />,
});

export default function Home() {
  return <OtthonApp />;
}
