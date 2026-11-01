const DINO_LEVEL = 450;
const IMPRINT_COMMAND_VALUE = 1.0;
const IMPRINT_PERCENTAGE = 100;
const SADDLE_QUALITY = 10.0;

const DELIVERY_MODES = new Set(['pair', 'single', 'single-random', 'unsupported']);

const GENDER = {
  MALE: 1,
  FEMALE: 2
};

const EOS_ID_PATTERN = /^[a-f0-9]{32}$/i;
const BLUEPRINT_PATTERN = /^\/[A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+$/;

function validateCreature(creature) {
  if (!creature || typeof creature !== 'object') {
    throw new Error('Creature configuration is required.');
  }
  if (!creature.id || typeof creature.id !== 'string') {
    throw new Error('Creature ID is required.');
  }
  if (!creature.name || typeof creature.name !== 'string') {
    throw new Error('Creature display name is required.');
  }
  if (!creature.blueprint || !BLUEPRINT_PATTERN.test(creature.blueprint)) {
    throw new Error(`Invalid blueprint path for ${creature.name || 'creature'}.`);
  }
  if (creature.tameable !== true) {
    throw new Error(`${creature.name} is not approved as a tameable creature.`);
  }
  if (creature.enabled !== true) {
    throw new Error(`${creature.name} is disabled in the fulfillment catalog.`);
  }
  if (typeof creature.supportsGender !== 'boolean') {
    throw new Error(`${creature.name} must specify supportsGender.`);
  }
  if (typeof creature.saddleApplicable !== 'boolean') {
    throw new Error(`${creature.name} must specify saddleApplicable.`);
  }
  const deliveryMode = creature.deliveryMode || (creature.supportsGender ? 'pair' : 'single-random');
  if (!DELIVERY_MODES.has(deliveryMode)) {
    throw new Error(`Invalid delivery mode for ${creature.name}.`);
  }
  if (deliveryMode === 'pair' && !creature.supportsGender) {
    throw new Error(`${creature.name} cannot use pair delivery without gender support.`);
  }
}

function validateEosId(eosId) {
  if (typeof eosId !== 'string' || !EOS_ID_PATTERN.test(eosId)) {
    throw new Error('Target EOS ID must contain exactly 32 hexadecimal characters.');
  }
}

function buildSummonCommand(creature, eosId, gender = null) {
  validateCreature(creature);
  validateEosId(eosId);

  if (gender !== null && gender !== GENDER.MALE && gender !== GENDER.FEMALE) {
    throw new Error('Gender must be male, female, or omitted.');
  }
  if (!creature.supportsGender && gender !== null) {
    throw new Error(`${creature.name} does not support a gender selection.`);
  }

  const argumentsList = [
    'scriptcommand AAT SummonDino',
    `"${creature.blueprint}"`,
    `-Level=${DINO_LEVEL}`,
    '-Tamed=true',
    `-ImprintPercentage=${IMPRINT_COMMAND_VALUE.toFixed(1)}`,
    `-saddled=${creature.saddleApplicable ? 'true' : 'false'}`
  ];

  if (creature.saddleApplicable) {
    argumentsList.push(`-SaddleQuality=${SADDLE_QUALITY.toFixed(1)}`);
  }
  if (gender !== null) {
    argumentsList.push(`-Gender=${gender}`);
  }

  argumentsList.push('-Cryo=true', `-Target="${eosId.toLowerCase()}"`);
  return argumentsList.join(' ');
}

function buildFulfillmentCommands(creature, eosId) {
  validateCreature(creature);
  validateEosId(eosId);

  const deliveryMode = creature.deliveryMode || (creature.supportsGender ? 'pair' : 'single-random');
  if (deliveryMode === 'unsupported') {
    throw new Error(`${creature.name} is not approved for automated fulfillment.`);
  }
  if (deliveryMode !== 'pair') {
    return [{
      key: 'genderless',
      label: creature.name,
      gender: null,
      command: buildSummonCommand(creature, eosId, null)
    }];
  }

  return [
    {
      key: 'male',
      label: `Male ${creature.name}`,
      gender: GENDER.MALE,
      command: buildSummonCommand(creature, eosId, GENDER.MALE)
    },
    {
      key: 'female',
      label: `Female ${creature.name}`,
      gender: GENDER.FEMALE,
      command: buildSummonCommand(creature, eosId, GENDER.FEMALE)
    }
  ];
}

function buildFulfillmentSummary(creature) {
  validateCreature(creature);
  return {
    creatureId: creature.id,
    creatureName: creature.name,
    level: DINO_LEVEL,
    tameable: true,
    imprintPercentage: IMPRINT_PERCENTAGE,
    delivery: 'Cryopod',
    deliveryMode: creature.deliveryMode || (creature.supportsGender ? 'pair' : 'single-random'),
    quantity: (creature.deliveryMode || (creature.supportsGender ? 'pair' : 'single-random')) === 'pair' ? 2 : 1,
    genders: (creature.deliveryMode || (creature.supportsGender ? 'pair' : 'single-random')) === 'pair' ? ['Male', 'Female'] : ['Not forced'],
    saddle: creature.saddleApplicable,
    saddleQuality: creature.saddleApplicable ? SADDLE_QUALITY : null
  };
}

module.exports = {
  DINO_LEVEL,
  GENDER,
  IMPRINT_COMMAND_VALUE,
  IMPRINT_PERCENTAGE,
  SADDLE_QUALITY,
  buildFulfillmentCommands,
  buildFulfillmentSummary,
  buildSummonCommand,
  validateCreature,
  validateEosId
};
