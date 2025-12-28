#!/usr/bin/env node
/**
 * MCP Test Harness
 * Spawns the MCP server and sends JSON-RPC requests to test tools
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';

class MCPTestClient {
  constructor() {
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.serverProcess = null;
    this.initialized = false;
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.serverProcess = spawn('node', ['build/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      const rl = createInterface({ input: this.serverProcess.stdout });

      rl.on('line', (line) => {
        try {
          const response = JSON.parse(line);
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(response.error);
            } else {
              pending.resolve(response.result);
            }
          }
        } catch (e) {
          // Ignore non-JSON lines
        }
      });

      this.serverProcess.stderr.on('data', (data) => {
        // Log stderr for debugging but don't fail
        // console.error('Server log:', data.toString());
      });

      this.serverProcess.on('error', reject);

      // Give server time to start
      setTimeout(() => resolve(), 500);
    });
  }

  async initialize() {
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-harness', version: '1.0.0' }
    });

    await this.sendNotification('notifications/initialized', {});
    this.initialized = true;
    return result;
  }

  sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.serverProcess.stdin.write(JSON.stringify(request) + '\n');

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  sendNotification(method, params) {
    const notification = {
      jsonrpc: '2.0',
      method,
      params
    };
    this.serverProcess.stdin.write(JSON.stringify(notification) + '\n');
  }

  async callTool(name, args = {}) {
    return this.sendRequest('tools/call', { name, arguments: args });
  }

  async listTools() {
    return this.sendRequest('tools/list', {});
  }

  async stop() {
    if (this.serverProcess) {
      this.serverProcess.kill();
    }
  }
}

// Main test execution
async function runTests() {
  const client = new MCPTestClient();
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  // Unique suffix for this test run to avoid collisions with leftover data
  const testSuffix = Date.now().toString().slice(-6);
  const testName = (base) => `${base} [TEST-${testSuffix}]`;

  const testIds = {
    userId: null,
    pipelineId: null,
    statusId: null,
    calendarId: null,
    groupId: null,
    customFieldId: null,
    testContactId: null,
    testCompanyId: null,
    testEventId: null,
    testTaskId: null,
    testNoteId: null,
    testPipelineItemId: null,
    testEmailId: null,
    testFileId: null,
    testRelationshipId: null,
    testGroupId: null,
    testPipelineId: null,
    testStatusId: null,
    testTeamId: null,
    testCustomFieldId: null
  };

  async function test(name, fn, debug = false) {
    try {
      const result = await fn();
      results.passed++;
      results.tests.push({ name, status: 'PASS', result });
      console.log(`✓ ${name}`);
      return result;
    } catch (error) {
      results.failed++;
      const errInfo = { message: error.message || error, lastResponse: error.lastResponse };
      results.tests.push({ name, status: 'FAIL', error: error.message || error });
      console.log(`✗ ${name}: ${error.message || JSON.stringify(error)}`);
      if (debug && error.lastResponse) {
        console.log(`  DEBUG: ${JSON.stringify(error.lastResponse).substring(0, 500)}`);
      }
      return null;
    }
  }

  try {
    console.log('Starting MCP server...');
    await client.start();

    console.log('Initializing...');
    await client.initialize();

    console.log('\n=== PHASE 1: Discovery Tools (Read-Only) ===\n');

    // Helper to extract array from different response formats
    function getArray(data) {
      if (Array.isArray(data)) return data;
      if (data && data.Results && Array.isArray(data.Results)) return data.Results;
      if (data && data.Result && Array.isArray(data.Result)) return data.Result;
      return null;
    }

    // get_users - returns array directly
    await test('get_users', async () => {
      const result = await client.callTool('get_users', {});
      const data = JSON.parse(result.content[0].text);
      const users = getArray(data);
      if (!users) throw new Error('Expected users array');
      testIds.userId = users[0]?.UserId;
      console.log(`  Found ${users.length} users. First UserId: ${testIds.userId}`);
      return data;
    });

    // get_pipelines - returns array directly
    await test('get_pipelines', async () => {
      const result = await client.callTool('get_pipelines', {});
      const data = JSON.parse(result.content[0].text);
      const pipelines = getArray(data);
      if (!pipelines) throw new Error('Expected pipelines array');
      if (pipelines.length > 0) {
        testIds.pipelineId = pipelines[0]?.PipelineId;
        testIds.statusId = pipelines[0]?.Statuses?.[0]?.StatusId;
      }
      console.log(`  Found ${pipelines.length} pipelines. First PipelineId: ${testIds.pipelineId}`);
      return data;
    });

    // get_groups - returns { HasMoreResults, Results: [...] }
    await test('get_groups', async () => {
      const result = await client.callTool('get_groups', {});
      const data = JSON.parse(result.content[0].text);
      const groups = getArray(data);
      if (!groups) throw new Error('Expected groups array');
      if (groups.length > 0) {
        testIds.groupId = groups[0]?.GroupId;
      }
      console.log(`  Found ${groups.length} groups. First GroupId: ${testIds.groupId}`);
      return data;
    });

    // get_custom_fields - returns { HasMoreResults, Results: [...] }
    await test('get_custom_fields', async () => {
      const result = await client.callTool('get_custom_fields', {});
      const data = JSON.parse(result.content[0].text);
      const fields = getArray(data);
      if (!fields) throw new Error('Expected custom fields array');
      if (fields.length > 0) {
        testIds.customFieldId = fields[0]?.CustomFieldId;
      }
      console.log(`  Found ${fields.length} custom fields.`);
      return data;
    });

    // get_calendars - returns array directly
    await test('get_calendars', async () => {
      const result = await client.callTool('get_calendars', {});
      const data = JSON.parse(result.content[0].text);
      const calendars = getArray(data);
      if (!calendars) throw new Error('Expected calendars array');
      if (calendars.length > 0) {
        testIds.calendarId = calendars[0]?.CalendarId;
      }
      console.log(`  Found ${calendars.length} calendars. First CalendarId: ${testIds.calendarId}`);
      return data;
    });

    console.log('\n=== PHASE 2: Create Test Contact ===\n');

    // Create test contact (person)
    await test('create_contact (test person)', async () => {
      const result = await client.callTool('create_contact', {
        name: testName('MCP Test Person'),
        is_company: false,
        assigned_to: testIds.userId
      });
      const text = result.content[0].text;
      const match = text.match(/ContactId: (\S+)/);
      if (!match) throw new Error('No ContactId in response');
      testIds.testContactId = match[1];
      console.log(`  Created test contact: ${testIds.testContactId}`);
      return text;
    });

    // Create test company
    await test('create_contact (test company)', async () => {
      const result = await client.callTool('create_contact', {
        name: testName('MCP Test Company'),
        is_company: true,
        assigned_to: testIds.userId
      });
      const text = result.content[0].text;
      console.log(`  DEBUG create_contact (company) response: ${text.substring(0, 300)}`);
      const match = text.match(/ContactId: (\S+)/);
      if (!match) throw new Error('No ContactId in response');
      testIds.testCompanyId = match[1];
      console.log(`  Created test company: ${testIds.testCompanyId}`);
      return text;
    });

    console.log('\n=== PHASE 2 continued: Contact Tools ===\n');

    // get_contact
    await test('get_contact', async () => {
      const result = await client.callTool('get_contact', {
        contact_id: testIds.testContactId
      });
      const data = JSON.parse(result.content[0].text);
      if (!data.ContactId) throw new Error('Expected ContactId in response');
      return data;
    });

    // edit_contact
    await test('edit_contact', async () => {
      const result = await client.callTool('edit_contact', {
        contact_id: testIds.testContactId,
        name: testName('MCP Test Person UPDATED')
      });
      if (!result.content[0].text.includes('updated successfully')) throw new Error('Expected success message');
      return result.content[0].text;
    });

    // search_contacts
    await test('search_contacts', async () => {
      const result = await client.callTool('search_contacts', {
        search_terms: 'MCP Test'
      });
      const data = JSON.parse(result.content[0].text);
      const contacts = getArray(data);
      if (!contacts) throw new Error('Expected contacts array');
      return data;
    });

    // get_contacts_by_ids
    await test('get_contacts_by_ids', async () => {
      const result = await client.callTool('get_contacts_by_ids', {
        contact_ids: [testIds.testContactId, testIds.testCompanyId]
      });
      const data = JSON.parse(result.content[0].text);
      console.log(`  DEBUG get_contacts_by_ids format: ${JSON.stringify(Object.keys(data || {})).substring(0, 100)}`);
      const contacts = getArray(data);
      if (!contacts) throw new Error('Expected array');
      return data;
    });

    // Error case: get_contact with invalid ID
    await test('get_contact (invalid ID - error case)', async () => {
      const result = await client.callTool('get_contact', {
        contact_id: 'invalid-id-12345'
      });
      if (!result.isError) throw new Error('Expected isError: true for invalid ID');
      return result;
    });

    console.log('\n=== PHASE 3: Activity Tools ===\n');

    // Events
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);

    await test('create_event', async () => {
      const result = await client.callTool('create_event', {
        name: testName('MCP Test Event'),
        start_date: tomorrow.toISOString(),
        end_date: dayAfter.toISOString(),
        contact_ids: [testIds.testContactId]
      });
      const text = result.content[0].text;
      const match = text.match(/EventId: (\S+)/);
      if (!match) throw new Error('No EventId in response');
      testIds.testEventId = match[1];
      console.log(`  Created test event: ${testIds.testEventId}`);
      return text;
    });

    await test('get_event', async () => {
      const result = await client.callTool('get_event', {
        event_id: testIds.testEventId
      });
      const data = JSON.parse(result.content[0].text);
      if (!data.EventId) throw new Error('Expected EventId');
      return data;
    });

    await test('edit_event', async () => {
      const result = await client.callTool('edit_event', {
        event_id: testIds.testEventId,
        name: testName('MCP Test Event UPDATED')
      });
      if (!result.content[0].text.includes('updated successfully')) throw new Error('Expected success');
      return result.content[0].text;
    });

    await test('search_events', async () => {
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 30);
      const result = await client.callTool('search_events', {
        start_date: start.toISOString(),
        end_date: end.toISOString()
      });
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    await test('get_events_attached_to_contact', async () => {
      const result = await client.callTool('get_events_attached_to_contact', {
        contact_id: testIds.testContactId
      });
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    // Tasks
    await test('create_task', async () => {
      const result = await client.callTool('create_task', {
        name: testName('MCP Test Task'),
        contact_id: testIds.testContactId,
        due_date: tomorrow.toISOString().split('T')[0]
      });
      const text = result.content[0].text;
      const match = text.match(/TaskId: (\S+)/);
      if (!match) throw new Error('No TaskId in response');
      testIds.testTaskId = match[1];
      console.log(`  Created test task: ${testIds.testTaskId}`);
      return text;
    });

    await test('get_task', async () => {
      const result = await client.callTool('get_task', {
        task_id: testIds.testTaskId
      });
      const data = JSON.parse(result.content[0].text);
      if (!data.TaskId) throw new Error('Expected TaskId');
      return data;
    });

    await test('edit_task', async () => {
      const result = await client.callTool('edit_task', {
        task_id: testIds.testTaskId,
        name: testName('MCP Test Task UPDATED')
      });
      if (!result.content[0].text.includes('updated successfully')) throw new Error('Expected success');
      return result.content[0].text;
    });

    await test('search_tasks', async () => {
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 30);
      const result = await client.callTool('search_tasks', {
        start_date: start.toISOString().split('T')[0],
        end_date: end.toISOString().split('T')[0]
      });
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    await test('get_tasks_attached_to_contact', async () => {
      const result = await client.callTool('get_tasks_attached_to_contact', {
        contact_id: testIds.testContactId
      });
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    // Notes
    await test('create_note', async () => {
      const result = await client.callTool('create_note', {
        contact_id: testIds.testContactId,
        note: testName('MCP Test Note')
      });
      const text = result.content[0].text;
      const match = text.match(/NoteId: (\S+)/);
      if (!match) throw new Error('No NoteId in response');
      testIds.testNoteId = match[1];
      console.log(`  Created test note: ${testIds.testNoteId}`);
      return text;
    });

    await test('get_note', async () => {
      const result = await client.callTool('get_note', {
        note_id: testIds.testNoteId
      });
      const data = JSON.parse(result.content[0].text);
      if (!data.NoteId) throw new Error('Expected NoteId');
      return data;
    });

    await test('edit_note', async () => {
      const result = await client.callTool('edit_note', {
        note_id: testIds.testNoteId,
        note: testName('MCP Test Note UPDATED')
      });
      if (!result.content[0].text.includes('updated successfully')) throw new Error('Expected success');
      return result.content[0].text;
    });

    await test('search_notes', async () => {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      const end = new Date();
      end.setDate(end.getDate() + 1);
      const result = await client.callTool('search_notes', {
        date_start: start.toISOString(),
        date_end: end.toISOString()
      });
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    await test('get_notes_attached_to_contact', async () => {
      const result = await client.callTool('get_notes_attached_to_contact', {
        contact_id: testIds.testContactId
      });
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    console.log('\n=== PHASE 4: Pipeline Item Tools ===\n');

    if (testIds.pipelineId && testIds.statusId) {
      await test('create_pipeline_item', async () => {
        const result = await client.callTool('create_pipeline_item', {
          contact_id: testIds.testContactId,
          pipeline_id: testIds.pipelineId,
          status_id: testIds.statusId,
          note: testName('MCP Test Pipeline Item')
        });
        const text = result.content[0].text;
        console.log(`  DEBUG create_pipeline_item response: ${text}`);
        const match = text.match(/PipelineItemId: (\S+)/);
        if (!match) throw new Error('No PipelineItemId in response');
        testIds.testPipelineItemId = match[1];
        console.log(`  Created pipeline item: ${testIds.testPipelineItemId}`);
        return text;
      });

      await test('get_pipeline_item', async () => {
        const result = await client.callTool('get_pipeline_item', {
          pipeline_item_id: testIds.testPipelineItemId
        });
        const data = JSON.parse(result.content[0].text);
        if (!data.PipelineItemId) throw new Error('Expected PipelineItemId');
        return data;
      });

      await test('edit_pipeline_item', async () => {
        const result = await client.callTool('edit_pipeline_item', {
          pipeline_item_id: testIds.testPipelineItemId,
          note: testName('MCP Test Pipeline Item UPDATED')
        });
        if (!result.content[0].text.includes('updated successfully')) throw new Error('Expected success');
        return result.content[0].text;
      });

      await test('search_pipeline_items', async () => {
        const result = await client.callTool('search_pipeline_items', {
          pipeline_id: testIds.pipelineId
        });
        const data = JSON.parse(result.content[0].text);
        return data;
      });

      await test('get_pipeline_items_attached_to_contact', async () => {
        const result = await client.callTool('get_pipeline_items_attached_to_contact', {
          contact_id: testIds.testContactId
        });
        const data = JSON.parse(result.content[0].text);
        return data;
      });
    } else {
      console.log('  SKIPPED: No pipeline or status found in the account');
    }

    console.log('\n=== PHASE 5: Email Tools ===\n');

    await test('create_email', async () => {
      const result = await client.callTool('create_email', {
        contact_ids: [testIds.testContactId],
        from: { Address: 'test@example.com', Name: 'Test Sender' },
        to: [{ Address: 'recipient@example.com', Name: 'Test Recipient' }],
        subject: testName('MCP Test Email'),
        body: 'This is a test email body',
        date: new Date().toISOString()
      });
      const text = result.content[0].text;
      const match = text.match(/EmailId: (\S+)/);
      if (!match) throw new Error('No EmailId in response');
      testIds.testEmailId = match[1];
      console.log(`  Created test email: ${testIds.testEmailId}`);
      return text;
    });

    await test('get_email', async () => {
      const result = await client.callTool('get_email', {
        email_id: testIds.testEmailId
      });
      const data = JSON.parse(result.content[0].text);
      if (!data.EmailId) throw new Error('Expected EmailId');
      return data;
    });

    await test('search_emails', async () => {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      const end = new Date();
      end.setDate(end.getDate() + 1);
      const result = await client.callTool('search_emails', {
        date_start: start.toISOString(),
        date_end: end.toISOString()
      });
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    await test('get_emails_attached_to_contact', async () => {
      const result = await client.callTool('get_emails_attached_to_contact', {
        contact_id: testIds.testContactId
      });
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    console.log('\n=== PHASE 6: File Tools ===\n');

    await test('create_file', async () => {
      // Base64 encoded "Hello, MCP Test!"
      const testContent = Buffer.from('Hello, MCP Test!').toString('base64');
      const result = await client.callTool('create_file', {
        contact_id: testIds.testContactId,
        file_base64: testContent,
        file_name: 'mcp-test-file.txt',
        mime_type: 'text/plain'
      });
      const text = result.content[0].text;
      const match = text.match(/FileId: (\S+)/);
      if (!match) throw new Error('No FileId in response');
      testIds.testFileId = match[1];
      console.log(`  Created test file: ${testIds.testFileId}`);
      return text;
    });

    await test('get_file', async () => {
      const result = await client.callTool('get_file', {
        file_id: testIds.testFileId
      });
      const data = JSON.parse(result.content[0].text);
      if (!data.FileId) throw new Error('Expected FileId');
      return data;
    });

    await test('get_files_attached_to_contact', async () => {
      const result = await client.callTool('get_files_attached_to_contact', {
        contact_id: testIds.testContactId
      });
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    // Security tests
    await test('create_file (path traversal - security test)', async () => {
      const result = await client.callTool('create_file', {
        contact_id: testIds.testContactId,
        file_path: '../../../etc/passwd'
      });
      if (!result.isError) throw new Error('Expected security error for path traversal');
      console.log(`  Security check passed: ${result.content[0].text}`);
      return result;
    });

    await test('create_file (sensitive path - security test)', async () => {
      const result = await client.callTool('create_file', {
        contact_id: testIds.testContactId,
        file_path: '/some/path/.git/config'
      });
      if (!result.isError) throw new Error('Expected security error for sensitive path');
      console.log(`  Security check passed: ${result.content[0].text}`);
      return result;
    });

    console.log('\n=== PHASE 7: Relationship Tools ===\n');

    await test('create_relationship', async () => {
      const result = await client.callTool('create_relationship', {
        contact_id_1: testIds.testContactId,
        contact_id_2: testIds.testCompanyId,
        note: 'MCP Test Relationship - Employee of test company'
      });
      const text = result.content[0].text;
      const match = text.match(/RelationshipId: (\S+)/);
      if (!match) throw new Error('No RelationshipId in response');
      testIds.testRelationshipId = match[1];
      console.log(`  Created test relationship: ${testIds.testRelationshipId}`);
      return text;
    });

    await test('get_relationship', async () => {
      const result = await client.callTool('get_relationship', {
        relationship_id: testIds.testRelationshipId
      });
      const data = JSON.parse(result.content[0].text);
      if (!data.RelationshipId) throw new Error('Expected RelationshipId');
      return data;
    });

    await test('edit_relationship', async () => {
      const result = await client.callTool('edit_relationship', {
        relationship_id: testIds.testRelationshipId,
        note: 'MCP Test Relationship UPDATED'
      });
      if (!result.content[0].text.includes('updated successfully')) throw new Error('Expected success');
      return result.content[0].text;
    });

    await test('get_relationships_attached_to_contact', async () => {
      const result = await client.callTool('get_relationships_attached_to_contact', {
        contact_id: testIds.testContactId
      });
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    console.log('\n=== PHASE 8: Group Membership Tools ===\n');

    // First create a test group
    await test('create_group (settings)', async () => {
      const result = await client.callTool('create_group', {
        name: testName('MCP Test Group'),
        sharing: 'Private',
        color: 'Blue'
      });
      const text = result.content[0].text;
      console.log(`  DEBUG create_group response: ${text.substring(0, 200)}`);
      const match = text.match(/GroupId: (\S+)/);
      if (!match) throw new Error('No GroupId in response');
      testIds.testGroupId = match[1];
      console.log(`  Created test group: ${testIds.testGroupId}`);
      return text;
    });

    await test('add_contact_to_group', async () => {
      const result = await client.callTool('add_contact_to_group', {
        contact_id: testIds.testContactId,
        group_id: testIds.testGroupId
      });
      if (!result.content[0].text.includes('added') && !result.content[0].text.includes('success')) {
        throw new Error('Expected success message');
      }
      return result.content[0].text;
    });

    await test('get_groups_for_contact', async () => {
      const result = await client.callTool('get_groups_for_contact', {
        contact_id: testIds.testContactId
      });
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    await test('get_contacts_in_group', async () => {
      const result = await client.callTool('get_contacts_in_group', {
        group_id: testIds.testGroupId
      });
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    // Validation tests
    await test('add_contact_to_group (both params - error case)', async () => {
      const result = await client.callTool('add_contact_to_group', {
        contact_id: testIds.testContactId,
        group_id: testIds.testGroupId,
        group_name: 'Some Name'
      });
      if (!result.isError) throw new Error('Expected error when both group_id and group_name provided');
      return result;
    });

    await test('add_contact_to_group (neither param - error case)', async () => {
      const result = await client.callTool('add_contact_to_group', {
        contact_id: testIds.testContactId
      });
      if (!result.isError) throw new Error('Expected error when neither group_id nor group_name provided');
      return result;
    });

    await test('remove_contact_from_group', async () => {
      const result = await client.callTool('remove_contact_from_group', {
        contact_id: testIds.testContactId,
        group_id: testIds.testGroupId
      });
      if (!result.content[0].text.includes('removed') && !result.content[0].text.includes('success')) {
        throw new Error('Expected success message');
      }
      return result.content[0].text;
    });

    console.log('\n=== PHASE 9: Settings Tools ===\n');

    // Custom Fields
    await test('create_custom_field', async () => {
      const result = await client.callTool('create_custom_field', {
        name: testName('MCP Test Field'),
        type: 'Text'
      });
      const text = result.content[0].text;
      console.log(`  DEBUG create_custom_field response: ${text.substring(0, 200)}`);
      const match = text.match(/CustomFieldId: (\S+)/);
      if (!match) throw new Error('No CustomFieldId in response');
      testIds.testCustomFieldId = match[1];
      console.log(`  Created test custom field: ${testIds.testCustomFieldId}`);
      return text;
    });

    await test('get_custom_field', async () => {
      const result = await client.callTool('get_custom_field', {
        custom_field_id: testIds.testCustomFieldId
      });
      const data = JSON.parse(result.content[0].text);
      if (!data.CustomFieldId) throw new Error('Expected CustomFieldId');
      return data;
    });

    await test('edit_custom_field', async () => {
      const result = await client.callTool('edit_custom_field', {
        custom_field_id: testIds.testCustomFieldId,
        name: testName('MCP Test Field UPDATED')
      });
      if (!result.content[0].text.includes('updated')) throw new Error('Expected success');
      return result.content[0].text;
    });

    // Pipelines
    await test('create_pipeline', async () => {
      const result = await client.callTool('create_pipeline', {
        name: testName('MCP Test Pipeline'),
        icon: 'deals'
      });
      const text = result.content[0].text;
      const match = text.match(/PipelineId: (\S+)/);
      if (!match) throw new Error('No PipelineId in response');
      testIds.testPipelineId = match[1];
      console.log(`  Created test pipeline: ${testIds.testPipelineId}`);
      return text;
    });

    await test('get_pipeline', async () => {
      const result = await client.callTool('get_pipeline', {
        pipeline_id: testIds.testPipelineId
      });
      const data = JSON.parse(result.content[0].text);
      if (!data.PipelineId) throw new Error('Expected PipelineId');
      return data;
    });

    await test('edit_pipeline', async () => {
      const result = await client.callTool('edit_pipeline', {
        pipeline_id: testIds.testPipelineId,
        name: testName('MCP Test Pipeline UPDATED')
      });
      if (!result.content[0].text.includes('updated')) throw new Error('Expected success');
      return result.content[0].text;
    });

    // Pipeline Statuses
    await test('create_pipeline_status', async () => {
      const result = await client.callTool('create_pipeline_status', {
        pipeline_id: testIds.testPipelineId,
        name: testName('MCP Test Status'),
        is_active: true,
        color: 'Green'
      });
      const text = result.content[0].text;
      const match = text.match(/StatusId: (\S+)/);
      if (!match) throw new Error('No StatusId in response');
      testIds.testStatusId = match[1];
      console.log(`  Created test status: ${testIds.testStatusId}`);
      return text;
    });

    await test('get_pipeline_statuses', async () => {
      const result = await client.callTool('get_pipeline_statuses', {
        pipeline_id: testIds.testPipelineId
      });
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    await test('edit_pipeline_status', async () => {
      const result = await client.callTool('edit_pipeline_status', {
        status_id: testIds.testStatusId,
        name: 'MCP Test Status UPDATED'
      });
      if (!result.content[0].text.includes('updated')) throw new Error('Expected success');
      return result.content[0].text;
    });

    // Teams
    await test('create_team', async () => {
      const result = await client.callTool('create_team', {
        name: testName('MCP Test Team')
      });
      const text = result.content[0].text;
      const match = text.match(/TeamId: (\S+)/);
      if (!match) throw new Error('No TeamId in response');
      testIds.testTeamId = match[1];
      console.log(`  Created test team: ${testIds.testTeamId}`);
      return text;
    });

    await test('get_team', async () => {
      const result = await client.callTool('get_team', {
        team_id: testIds.testTeamId
      });
      const data = JSON.parse(result.content[0].text);
      if (!data.TeamId) throw new Error('Expected TeamId');
      return data;
    });

    await test('get_teams', async () => {
      const result = await client.callTool('get_teams', {});
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    await test('edit_team', async () => {
      const result = await client.callTool('edit_team', {
        team_id: testIds.testTeamId,
        name: testName('MCP Test Team UPDATED')
      });
      if (!result.content[0].text.includes('updated')) throw new Error('Expected success');
      return result.content[0].text;
    });

    // Webhooks - test HTTPS validation
    await test('create_webhook (HTTP URL - error case)', async () => {
      const result = await client.callTool('create_webhook', {
        endpoint_url: 'http://example.com/webhook',
        events: ['Contact.Create'],
        webhook_scope: 'User'
      });
      if (!result.isError) throw new Error('Expected error for HTTP URL');
      console.log(`  HTTPS validation passed: ${result.content[0].text}`);
      return result;
    });

    await test('get_webhooks', async () => {
      const result = await client.callTool('get_webhooks', {});
      const data = JSON.parse(result.content[0].text);
      return data;
    });

    console.log('\n=== CLEANUP: Deleting All Test Data ===\n');

    // Delete in reverse order of dependencies

    // Delete pipeline status first
    if (testIds.testStatusId) {
      await test('delete_pipeline_status (cleanup)', async () => {
        const result = await client.callTool('delete_pipeline_status', {
          status_id: testIds.testStatusId
        });
        return result.content[0].text;
      });
    }

    // Delete pipeline
    if (testIds.testPipelineId) {
      await test('delete_pipeline (cleanup)', async () => {
        const result = await client.callTool('delete_pipeline', {
          pipeline_id: testIds.testPipelineId
        });
        return result.content[0].text;
      });
    }

    // Delete team
    if (testIds.testTeamId) {
      await test('delete_team (cleanup)', async () => {
        const result = await client.callTool('delete_team', {
          team_id: testIds.testTeamId
        });
        return result.content[0].text;
      });
    }

    // Delete custom field
    if (testIds.testCustomFieldId) {
      await test('delete_custom_field (cleanup)', async () => {
        const result = await client.callTool('delete_custom_field', {
          custom_field_id: testIds.testCustomFieldId
        });
        return result.content[0].text;
      });
    }

    // Delete group
    if (testIds.testGroupId) {
      await test('delete_group (cleanup)', async () => {
        const result = await client.callTool('delete_group', {
          group_id: testIds.testGroupId
        });
        return result.content[0].text;
      });
    }

    // Delete relationship
    if (testIds.testRelationshipId) {
      await test('delete_relationship (cleanup)', async () => {
        const result = await client.callTool('delete_relationship', {
          relationship_id: testIds.testRelationshipId
        });
        return result.content[0].text;
      });
    }

    // Delete email
    if (testIds.testEmailId) {
      await test('delete_email (cleanup)', async () => {
        const result = await client.callTool('delete_email', {
          email_id: testIds.testEmailId
        });
        return result.content[0].text;
      });
    }

    // Delete pipeline item
    if (testIds.testPipelineItemId) {
      await test('delete_pipeline_item (cleanup)', async () => {
        const result = await client.callTool('delete_pipeline_item', {
          pipeline_item_id: testIds.testPipelineItemId
        });
        return result.content[0].text;
      });
    }

    // Delete note
    if (testIds.testNoteId) {
      await test('delete_note (cleanup)', async () => {
        const result = await client.callTool('delete_note', {
          note_id: testIds.testNoteId
        });
        return result.content[0].text;
      });
    }

    // Delete task
    if (testIds.testTaskId) {
      await test('delete_task (cleanup)', async () => {
        const result = await client.callTool('delete_task', {
          task_id: testIds.testTaskId
        });
        return result.content[0].text;
      });
    }

    // Delete event
    if (testIds.testEventId) {
      await test('delete_event (cleanup)', async () => {
        const result = await client.callTool('delete_event', {
          event_id: testIds.testEventId
        });
        return result.content[0].text;
      });
    }

    // Delete test company
    if (testIds.testCompanyId) {
      await test('delete_contact (test company cleanup)', async () => {
        const result = await client.callTool('delete_contact', {
          contact_id: testIds.testCompanyId
        });
        return result.content[0].text;
      });
    }

    // Delete test contact
    if (testIds.testContactId) {
      await test('delete_contact (test person cleanup)', async () => {
        const result = await client.callTool('delete_contact', {
          contact_id: testIds.testContactId
        });
        return result.content[0].text;
      });
    }

    console.log('\n========================================');
    console.log(`RESULTS: ${results.passed} passed, ${results.failed} failed`);
    console.log('========================================\n');

    // Output JSON results
    console.log('TEST_RESULTS_JSON_START');
    console.log(JSON.stringify(results, null, 2));
    console.log('TEST_RESULTS_JSON_END');

  } catch (error) {
    console.error('Test harness error:', error);
  } finally {
    await client.stop();
  }
}

runTests();
