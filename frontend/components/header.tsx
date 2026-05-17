import Image from "next/image"

export function Header() {
  return (
    <header className="w-full px-6 py-4 md:px-12 lg:px-16">
      <nav className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center">
          <Image
            src="/logo.png"
            alt="Global Field Connectivity Copilot"
            width={216}
            height={60}
            priority
            className="h-[60px] w-auto object-contain"
          />
        </div>
      </nav>
    </header>
  )
}
