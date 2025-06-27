const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { ConsoleSpanExporter, SimpleSpanProcessor, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

// Create a tracer provider with proper service name
// NodeTracerProvider will pick up service name from OTEL_SERVICE_NAME environment variable
const provider = new NodeTracerProvider();

// Configure console exporter only in development mode
if (process.env.NODE_ENV === 'development') {
  // Custom filter to prevent /metrics and /health from being logged to console
  const filteredConsoleExporter = new ConsoleSpanExporter({
    exporterFilter: (span) => {
      // Filter out metrics and health check spans
      if (span.attributes && span.attributes['http.target']) {
        const target = span.attributes['http.target'];
        if (target === '/metrics' || target === '/health') {
          return false; // Don't export this span
        }
      }
      return true; // Export all other spans
    },
  });

  provider.addSpanProcessor(
    new SimpleSpanProcessor(filteredConsoleExporter)
  );
}

// Configure Jaeger exporter for production
const jaegerExporter = new JaegerExporter({
  endpoint: process.env.JAEGER_ENDPOINT || 'http://jaeger:16686/api/traces',
});

// Use batch processor for better performance
provider.addSpanProcessor(new BatchSpanProcessor(jaegerExporter));

// Register instrumentations
provider.register();

// Configure HTTP instrumentation
new HttpInstrumentation({
  // Ignore specific routes from tracing
  ignoreIncomingRequestHook: (req) => {
    return req.url === '/metrics' || req.url === '/health';
  }
}).setTracerProvider(provider);

// Configure Redis instrumentation
new RedisInstrumentation().setTracerProvider(provider);