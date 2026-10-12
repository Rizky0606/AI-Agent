export interface RuntimeOutputPreview {
  id: string;
  title: string;
  content: string;
  truncated: boolean;
}

const MAX_PREVIEW_CHARS = 20_000;

export function getRuntimeOutputPreviews(artifacts: unknown[] | null | undefined): RuntimeOutputPreview[] {
  if (!artifacts) return [];
  return artifacts.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const artifact = value as Record<string, unknown>;
    if (artifact.type !== 'runtime_output' || typeof artifact.content !== 'string') return [];
    const content = artifact.content;
    return [{
      id: typeof artifact.id === 'string' ? artifact.id : 'runtime-output',
      title: typeof artifact.title === 'string' ? artifact.title : 'Runtime output',
      content: content.slice(0, MAX_PREVIEW_CHARS),
      truncated: content.length > MAX_PREVIEW_CHARS,
    }];
  });
}
