const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { ConsoleSpanExporter, SimpleSpanProcessor, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

// Create a tracer provider with proper service name
const provider = new NodeTracerProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'task-worker',
  }),
});

// Only log to console in development mode
if (process.env.NODE_ENV === 'development') {
  // Limit how often spans get exported to console (once per minute)
  let lastExportTime = 0;
  const EXPORT_INTERVAL = 60000; // 1 minute
  
  const throttledConsoleExporter = new ConsoleSpanExporter({
    exporterFilter: () => {
      const now = Date.now();
      if (now - lastExportTime > EXPORT_INTERVAL) {
        lastExportTime = now;
        return true; // Export this batch
      }
      return false; // Skip this batch
    }
  });
  
  provider.addSpanProcessor(
    new SimpleSpanProcessor(throttledConsoleExporter)
  );
}

// Configure Jaeger exporter
const jaegerExporter = new JaegerExporter({
  endpoint: process.env.JAEGER_ENDPOINT || 'http://jaeger:16686/api/traces',
});

// Use batch processor for better performance
provider.addSpanProcessor(new BatchSpanProcessor(jaegerExporter));

// Register instrumentations
provider.register();

// Configure Redis instrumentation
new RedisInstrumentation().setTracerProvider(provider);