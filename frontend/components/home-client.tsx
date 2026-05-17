"use client"

import { useState } from "react"

import { AnalysisConsole } from "@/components/AnalysisConsole"
import { Header } from "@/components/header"
import { HeroSection } from "@/components/hero-section"
import { InteractiveMap } from "@/components/InteractiveMap"
import type { AnalysisLaunchPayload } from "@/lib/types"

type AppState = "selection" | "analysis"

export function HomeClient() {
  const [appState, setAppState] = useState<AppState>("selection")
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisLaunchPayload | null>(null)

  const handleConfirmSelection = (payload: AnalysisLaunchPayload) => {
    setSelectedAnalysis(payload)
    setAppState("analysis")
    window.requestAnimationFrame(() => {
      document.getElementById("analysis-console")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    })
  }

  const handleAnalysisFatalError = () => {
    setSelectedAnalysis(null)
    setAppState("selection")
    window.requestAnimationFrame(() => {
      document.getElementById("interactive-map")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    })
  }

  return (
    <main className="min-h-screen bg-background">
      {appState === "selection" && (
        <>
          <Header />
          <HeroSection />
          <section
            id="interactive-map"
            className="relative flex min-h-screen scroll-mt-0 items-center justify-center overflow-hidden border-t border-border/40 px-6 py-24"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(70,120,190,0.18),transparent_42%)]" />
            <div className="relative z-10 mx-auto w-full max-w-6xl">
              <InteractiveMap onConfirmSelection={handleConfirmSelection} />
            </div>
          </section>
        </>
      )}

      {appState === "analysis" && selectedAnalysis && (
        <section
          id="analysis-console"
          className="relative min-h-screen overflow-hidden border-t border-border/40 bg-[#02050a] px-4 py-6 md:px-6 md:py-10"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(70,120,190,0.18),transparent_42%)]" />
          <div className="relative z-10 mx-auto w-full max-w-7xl">
            <AnalysisConsole
              location={selectedAnalysis.location}
              request={selectedAnalysis.request}
              onBack={handleAnalysisFatalError}
              onFatalError={handleAnalysisFatalError}
            />
          </div>
        </section>
      )}
    </main>
  )
}
