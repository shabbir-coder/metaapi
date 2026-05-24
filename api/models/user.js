// models/user.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username:     String,
  email:        String,
  password:     String,
  phoneNo:      Number,
  token:        String,
  refreshToken: String,
  isActive: {
    type:    Boolean,
    default: false,
  },
  isVerified: {
    type:    Boolean,
    default: false,
  },
});

// ── CosmosDB: explicit indexes for every field used in queries / sorts ──
// CosmosDB excludes all paths by default; only indexed paths are queryable.
userSchema.index({ email:    1 });
userSchema.index({ username: 1 });
userSchema.index({ phoneNo:  1 });
userSchema.index({ isActive: 1 });

const User = mongoose.model('user', userSchema);

module.exports = User;