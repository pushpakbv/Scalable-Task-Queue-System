#!/usr/bin/env node

// Simple test script to verify the task queue API
const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:3000';

async function makeRequest(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    return { error: error.message };
  }
}

async function testAPI() {
  console.log('🧪 Testing Task Queue API...\n');

  // Test health endpoint
  console.log('1. Checking system health...');
  const health = await makeRequest(`${API_URL}/health`);
  console.log(`   Status: ${health.status || 'ERROR'}`);
  if (health.data) {
    console.log(`   Database: ${health.data.database ? '✅' : '❌'}`);
    console.log(`   Redis: ${health.data.redis ? '✅' : '❌'}`);
    console.log(`   Circuit Breaker: ${health.data.circuitBreaker ? '✅' : '❌'}`);
    console.log(`   Queue Length: ${health.data.queueLength || 0}`);
  }
  console.log('');

  // Test task submission
  console.log('2. Testing task submission...');
  const taskTypes = ['image_resize', 'data_processing', 'load_test'];
  
  for (const taskType of taskTypes) {
    const task = await makeRequest(`${API_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: taskType,
        data: `test-${taskType}-${Date.now()}`
      })
    });
    
    if (task.status === 201) {
      console.log(`   ✅ ${taskType}: ${task.data.taskId}`);
    } else {
      console.log(`   ❌ ${taskType}: ${task.data?.error || task.error}`);
    }
  }
  console.log('');

  // Test invalid task submission
  console.log('3. Testing error handling...');
  const invalidTask = await makeRequest(`${API_URL}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'invalid_type' })
  });
  
  if (invalidTask.status === 400) {
    console.log('   ✅ Invalid task type properly rejected');
  } else {
    console.log('   ❌ Invalid task handling failed');
  }
  console.log('');

  // Test task listing
  console.log('4. Testing task listing...');
  const tasks = await makeRequest(`${API_URL}/api/tasks`);
  if (tasks.status === 200) {
    console.log(`   ✅ Retrieved ${tasks.data.length} tasks`);
  } else {
    console.log(`   ❌ Failed to retrieve tasks: ${tasks.data?.error || tasks.error}`);
  }
  console.log('');

  console.log('🏁 Test completed!');
}

// Check if fetch is available (Node.js 18+)
if (typeof fetch === 'undefined') {
  console.error('❌ This test requires Node.js 18+ or you can install node-fetch');
  process.exit(1);
}

testAPI().catch(console.error);
