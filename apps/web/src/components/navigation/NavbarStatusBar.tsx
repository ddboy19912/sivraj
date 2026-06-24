import { BookOpen } from "lucide-react";
import { FaRegClock } from "react-icons/fa";
import { FaMicrochip } from "react-icons/fa6";
import { IoRadioSharp } from "react-icons/io5";
import { useOnlineStatus } from "@/hooks/common/use-online-status";

const DOCS_URL = "https://sivraj-docs.vercel.app/";

interface NavbarStatusBarProps {
  color: string;
  localTime: string;
  providerStatus: "default" | "connected" | "local" | "missing";
  onProviderClick?: () => void;
}

export function NavbarStatusBar({
  color,
  localTime,
  providerStatus,
  onProviderClick,
}: NavbarStatusBarProps) {
  const isOnline = useOnlineStatus();
  const providerTitle = getProviderTitle(providerStatus);

  return (
    <div className="hidden md:flex items-center gap-4 px-5 py-2 bg-gray-200/8 rounded-full border border-white/5">
      <div className="flex items-center gap-3">
        <IoRadioSharp
          title={isOnline ? "Connected" : "Disconnected"}
          color={isOnline ? "var(--color-success)" : "var(--color-danger)"}
          size={16}
        />
        <button
          type="button"
          aria-label="LLM provider settings"
          title={providerTitle}
          onClick={onProviderClick}
          className="grid size-5 place-items-center rounded-full text-[#b9cacb66] transition hover:bg-white/6 hover:text-[rgb(var(--theme-color-rgb))] focus:outline-none focus-visible:ring-3 focus-visible:ring-[rgba(var(--theme-color-rgb),0.22)]"
        >
          <FaMicrochip
            color={providerStatus === "missing" ? "#b9cacb66" : color}
            size={16}
          />
        </button>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Open Sivraj docs"
          title="Open Sivraj docs"
          className="grid size-5 place-items-center rounded-full text-[#b9cacb66] transition hover:bg-white/6 hover:text-[rgb(var(--theme-color-rgb))] focus:outline-none focus-visible:ring-3 focus-visible:ring-[rgba(var(--theme-color-rgb),0.22)]"
        >
          <BookOpen className="size-4" strokeWidth={2} aria-hidden="true" />
        </a>
      </div>
      <hr className="h-4 w-px bg-[#b9cacb66] border-none" />
      <div className="flex items-center gap-3">
        <FaRegClock color={color} size={16} />
        <p
          style={{ color }}
          className="text-sm font-mono uppercase font-bold tracking-[1.2px] leading-none"
        >
          {localTime}
        </p>
      </div>
    </div>
  );
}

const getProviderTitle = (status: string) => {
  switch (status) {
    case "local":
      return "Local Ollama model connected";
    case "connected":
      return "User LLM connected";
    case "default":
      return "Using Sivraj default model";
    default:
      return "Connect an LLM";
  }
};
