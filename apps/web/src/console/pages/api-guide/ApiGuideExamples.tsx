type ApiGuideExample = {
  title: string
  curl: string
}

type ApiGuideExamplesProps = {
  examples: ApiGuideExample[]
}

export function ApiGuideExamples({ examples }: ApiGuideExamplesProps) {
  return (
    <>
      {examples.map((example) => (
        <div key={example.title} className="console-panel wide">
          <h3>{example.title}</h3>
          <pre>{example.curl}</pre>
        </div>
      ))}
    </>
  )
}
