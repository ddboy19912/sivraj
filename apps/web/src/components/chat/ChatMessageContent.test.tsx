import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
  });

  it("renders inline code without treating it as a block", () => {
    render(<ChatMessageContent content="Use `const` for fixed bindings." />);

    expect(screen.getByText("const")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy code" })).not.toBeInTheDocument();
  });
});
