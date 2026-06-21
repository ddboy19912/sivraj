import {
  Home,
  MessageCircle,
  Brain,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { NavigationTabButton } from "@/components/navigation/NavigationTabButton";
import { liquidGlass } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";

export type NavigationTabId = "home" | "chat" | "brain" | "settings";

const TABS: {
  id: NavigationTabId;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "brain", label: "Brain", icon: Brain },
  { id: "settings", label: "Settings", icon: Settings },
];

type NavigationTabProps = {
  activeTab?: NavigationTabId;
  onTabChange?: (tab: NavigationTabId) => void;
};

export function NavigationTab({
  activeTab: activeTabProp,
  onTabChange,
}: NavigationTabProps) {
  const [activeTabState, setActiveTabState] = useState<NavigationTabId>("home");
  const activeTab = activeTabProp ?? activeTabState;

  function selectTab(tab: NavigationTabId) {
    onTabChange?.(tab);
    if (activeTabProp === undefined) {
      setActiveTabState(tab);
    }
  }

  return (
    <nav
      className="absolute bottom-[max(20px,env(safe-area-inset-bottom))] left-1/2 z-50 w-[min(calc(100vw-32px),500px)] -translate-x-1/2"
      aria-label="Main navigation"
    >
      <div className={cn(liquidGlass, "overflow-hidden rounded-[28px] p-1")}>
        <ul className="relative z-1 flex items-stretch gap-1">
          {TABS.map((tab) => (
            <NavigationTabButton
              key={tab.id}
              id={tab.id}
              label={tab.label}
              icon={tab.icon}
              isActive={activeTab === tab.id}
              onSelect={selectTab}
            />
          ))}
        </ul>
      </div>
    </nav>
  );
}
