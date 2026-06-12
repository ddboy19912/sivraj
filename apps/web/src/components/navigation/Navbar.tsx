import { NavbarBrand } from "@/components/navigation/NavbarBrand";
import { NavbarStatusBar } from "@/components/navigation/NavbarStatusBar";
import { useLocalTime } from "@/hooks/common/use-local-time";
import { useTheme } from "@/providers/theme-context";

type NavbarProps = {
  onProviderClick?: () => void;
  providerStatus?: "default" | "connected" | "local" | "missing";
};

export const Navbar = ({
  onProviderClick,
  providerStatus = "missing",
}: NavbarProps) => {
  const { color } = useTheme();
  const localTime = useLocalTime();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 w-full flex items-center justify-between p-6">
      <NavbarBrand color={color} />
      <NavbarStatusBar
        color={color}
        localTime={localTime}
        providerStatus={providerStatus}
        onProviderClick={onProviderClick}
      />
    </nav>
  );
};
