import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatMessageContent } from "@/components/chat/ChatMessageContent";

describe("ChatMessageContent", () => {
  it("renders assistant markdown with a solid code block copy affordance", () => {
    render(
      <ChatMessageContent
        content={[
          "**Example:**",
          "",
          "- A closure keeps outer scope alive.",
          "",
          "```javascript",
          "const greeting = 'hello';",
          "```",
        ].join("\n")}
      />,
    );

    expect(screen.getByText("Example:")).toBeInTheDocument();
    expect(screen.getByText("A closure keeps outer scope alive.")).toBeInTheDocument();
    expect(screen.getByText("javascript")).toBeInTheDocument();
    expect(screen.getByText("const greeting = 'hello';")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save code block as source file" }))
      .not.toBeInTheDocument();
  });

  it("saves fenced code blocks with a custom filename", async () => {
    const user = userEvent.setup();
    const onSaveCodeBlock = vi.fn();
    render(
      <ChatMessageContent
        content={[
          "```markdown",
          "# AGENTS.md",
          "",
          "Keep exact content.",
          "```",
        ].join("\n")}
        onSaveCodeBlock={onSaveCodeBlock}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save code block as source file" }));
    const input = screen.getByLabelText("Custom filename");
    await user.clear(input);
    await user.type(input, "team-agent");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSaveCodeBlock).toHaveBeenCalledWith(
      "# AGENTS.md\n\nKeep exact content.",
      "team-agent.md",
    );
  });

  it("renders inline code without treating it as a block", () => {
    render(<ChatMessageContent content="Use `const` for fixed bindings." />);

    expect(screen.getByText("const")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy code" })).not.toBeInTheDocument();
  });
});
