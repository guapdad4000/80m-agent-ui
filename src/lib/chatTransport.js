export const isOpenAICompatibleEndpoint = (url = '') => {
  const normalized = String(url || '').toLowerCase();
  return normalized.includes('/v1/chat/completions') || normalized.includes('/chat/completions');
};

export const buildApiPayload = ({ endpoint, message, agentId, provider }) => {
  if (isOpenAICompatibleEndpoint(endpoint)) {
    return {
      model: 'local-model',
      messages: [{ role: 'user', content: message }],
      temperature: 0.2,
      stream: false,
      metadata: { agent_id: agentId },
    };
  }
  return { message, agent_id: agentId, provider };
};

export const extractAssistantText = (data) => {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.response === 'string') return data.response;
  if (typeof data.output === 'string') return data.output;
  if (typeof data.message === 'string') return data.message;

  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : part?.text || ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
};
