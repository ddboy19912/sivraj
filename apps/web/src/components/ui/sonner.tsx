import { Toaster as Sonner, type ToasterProps } from "sonner";
import "sonner/dist/styles.css";
import "@/styles/sonner.css";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      offset={18}
      gap={10}
      closeButton
      className="sivraj-sonner"
      toastOptions={{
        duration: 3600,
        classNames: {
          toast: "sivraj-toast",
          title: "sivraj-toast-title",
          description: "sivraj-toast-description",
          icon: "sivraj-toast-icon",
          actionButton: "sivraj-toast-action",
          cancelButton: "sivraj-toast-cancel",
          closeButton: "sivraj-toast-close",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
