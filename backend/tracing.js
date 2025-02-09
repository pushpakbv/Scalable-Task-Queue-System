const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { ConsoleSpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis');

const provider = new NodeTracerProvider();

// Export traces to console (for development)
provider.addSpanProcessor(
  new SimpleSpanProcessor(
    new ConsoleSpanExporter()
  )
);

// Register instrumentations
provider.register();
new HttpInstrumentation().setTracerProvider(provider);
new RedisInstrumentation().setTracerProvider(provider);