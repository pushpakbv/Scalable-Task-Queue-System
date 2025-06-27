const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { ConsoleSpanExporter, SimpleSpanProcessor, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

(async () => {
  const { Resource } = await import('@opentelemetry/resources');
  
  // Create a tracer provider with proper service name
  const provider = new NodeTracerProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'task-worker',
    }),
  });

  // Only log to console in development mode
  if (process.env.NODE_ENV === 'development') {
    let lastExportTime = 0;
    const EXPORT_INTERVAL = 60000;
    const throttledConsoleExporter = new ConsoleSpanExporter({
      exporterFilter: () => {
        const now = Date.now();
        if (now - lastExportTime > EXPORT_INTERVAL) {
          lastExportTime = now;
          return true;
        }
        return false;
      }
    });
    provider.addSpanProcessor(new SimpleSpanProcessor(throttledConsoleExporter));
  }

  // Configure Jaeger exporter and batch processor
  const jaegerExporter = new JaegerExporter({
    endpoint: process.env.JAEGER_ENDPOINT || 'http://jaeger:16686/api/traces',
  });
  provider.addSpanProcessor(new BatchSpanProcessor(jaegerExporter));

  // Register provider and instrumentations
  provider.register();
  new RedisInstrumentation().setTracerProvider(provider);
})();