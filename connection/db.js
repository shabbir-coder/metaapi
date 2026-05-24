// db.js
const mongoose = require('mongoose');

// Import all models for index sync
const User = require('../api/models/user');
const Instance = require('../api/models/instanceModel');
const Campaign = require('../api/models/campaignModel');
const {Event, TemplateMasters} = require('../api/models/event.Model');
const {Contact, Message, ChatLogs, Participation, File} = require('../api/models/chatModel');
const SetModel = require('../api/models/setModel');
const FileModel = require('../api/models/fileModel');

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    await mongoose.connect(mongoURI, {
      // CosmosDB recommended options
      retryWrites: false,        // CosmosDB does not support retryWrites
      tls: true,                 // Required for CosmosDB
    });
    console.log('✅ Connected to CosmosDB via Mongoose');

    // Sync indexes after connection
    await syncAllIndexes();

  } catch (error) {
    console.error('❌ CosmosDB connection error:', error.message);
    process.exit(1);
  }
};

async function syncAllIndexes() {
  const models = [
    { name: 'User',           model: User },
    { name: 'Instance',       model: Instance },
    { name: 'Campaign',       model: Campaign },
    { name: 'Event',          model: Event },
    { name: 'TemplateMasters',model: TemplateMasters },
    { name: 'Contact',        model: Contact },
    { name: 'Message',        model: Message },
    { name: 'ChatLogs',       model: ChatLogs },
    { name: 'Participation',  model: Participation },
    { name: 'File',           model: File },
    { name: 'SetModel',       model: SetModel },
  ];

  console.log('🔄 Starting index synchronization for all models...');

  const results = [];

  for (const { name, model } of models) {
    try {
      await model.syncIndexes();
      console.log(`✅ ${name}: Indexes synced successfully`);
      results.push({ model: name, status: 'success' });
    } catch (error) {
      console.error(`❌ ${name}: Index sync failed -`, error.message);
      results.push({ model: name, status: 'failed', error: error.message });
    }
  }

  const successful = results.filter(r => r.status === 'success').length;
  const failed     = results.filter(r => r.status === 'failed').length;

  console.log('\n📊 Index Sync Summary:');
  console.log(`   ✅ Successful: ${successful}/${models.length}`);
  console.log(`   ❌ Failed:     ${failed}/${models.length}`);

  if (failed > 0) {
    console.log('\n⚠️  Failed models:');
    results
      .filter(r => r.status === 'failed')
      .forEach(r => console.log(`   - ${r.model}: ${r.error}`));
  }

  return results;
}

module.exports = { connectDB, syncAllIndexes };