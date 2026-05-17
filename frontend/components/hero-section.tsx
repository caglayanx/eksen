"use client"

import { WorldMap } from "./world-map"

export function HeroSection() {
  const scrollToInteractiveMap = () => {
    document.getElementById("interactive-map")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    })
  }

  return (
    <section className="relative min-h-[calc(100svh-72px)] overflow-hidden px-6 py-12 md:py-16">
      {/* Background Map */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="w-full h-full opacity-80">
          <WorldMap />
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 mx-auto flex min-h-[calc(100svh-72px)] max-w-4xl -translate-y-[17.5vh] flex-col items-center justify-center text-center">
        <h1 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight text-primary text-balance leading-tight">
          Otonom Ağ Optimizasyon Sistemi
        </h1>
        <p className="mt-4 md:mt-6 text-base md:text-lg text-muted-foreground font-normal tracking-wide">
          Küresel bağlantı operasyonlarının optimizasyonu
        </p>
        <button
          type="button"
          onClick={scrollToInteractiveMap}
          className="mt-8 inline-flex items-center justify-center rounded-full bg-[oklch(0.55_0.10_240)] px-8 py-3 text-sm font-semibold tracking-wide text-white shadow-[0_14px_40px_rgba(53,111,191,0.28)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[oklch(0.60_0.12_240)] hover:shadow-[0_18px_48px_rgba(53,111,191,0.34)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.68_0.12_240)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Başla
        </button>
      </div>
    </section>
  )
}
