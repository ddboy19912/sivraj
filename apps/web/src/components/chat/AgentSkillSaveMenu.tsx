import { FileCode2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AGENT_INSTRUCTION_SAVE_TARGETS,
  agentInstructionLabel,
  normalizeSourceFileName,
} from "@/lib/ingest/agent-instruction-source";
import { cn } from "@/lib/ui/utils";

type AgentSkillSaveMenuProps = {
  ariaLabel: string;
  defaultFileName?: string;
  disabled?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  triggerClassName?: string;
  onSelect: (fileName: string) => void;
};

export function AgentSkillSaveMenu({
  ariaLabel,
  defaultFileName = "source.md",
  disabled = false,
  side = "top",
  triggerClassName,
  onSelect,
}: AgentSkillSaveMenuProps) {
  const fileNameInputId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [customFileName, setCustomFileName] = useState(defaultFileName);

  function saveFileName(fileName: string) {
    onSelect(normalizeSourceFileName(fileName, defaultFileName));
    setIsOpen(false);
  }

  function handleCustomSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveFileName(customFileName);
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          title={ariaLabel}
          disabled={disabled}
          className={cn(
            "grid size-7 place-items-center rounded-full text-white/30 transition hover:bg-white/7 hover:text-white/72 focus-visible:bg-white/7 focus-visible:text-white/72 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
            triggerClassName,
          )}
        >
          <FileCode2 className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align="end" className="w-64 p-1.5">
        <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-normal text-white/38">
          Save source file
        </div>
        <div className="grid gap-1">
          {AGENT_INSTRUCTION_SAVE_TARGETS.map((targetFile) => (
            <button
              key={targetFile}
              type="button"
              className="rounded-md px-2 py-2 text-left text-xs font-semibold text-white/78 transition hover:bg-white/8 hover:text-white/95 focus-visible:bg-white/8 focus-visible:text-white/95 focus-visible:outline-none"
              onClick={() => saveFileName(targetFile)}
            >
              {agentInstructionLabel(targetFile)}
            </button>
          ))}
        </div>
        <form className="mt-1 grid gap-1.5 border-t border-white/8 px-1 pt-2" onSubmit={handleCustomSubmit}>
          <label className="px-1 text-[11px] font-medium text-white/44" htmlFor={fileNameInputId}>
            Custom filename
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              id={fileNameInputId}
              value={customFileName}
              onChange={(event) => setCustomFileName(event.target.value)}
              className="h-8 rounded-[10px] px-2 text-xs"
              placeholder={defaultFileName}
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              className="h-8 rounded-[10px] px-2 text-xs"
            >
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
