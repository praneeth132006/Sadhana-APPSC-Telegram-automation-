// ============================================
// create-sample.js — Creates sample config.xlsx and questions.xlsx files
// ============================================
// Run this ONCE to generate the template Excel files with sample data.
// You can then edit these files in Excel/Google Sheets to add your own questions.
//
// Usage:
//   node create-sample.js
//
// Creates:
//   config.xlsx     — Subject config (names, emojis, schedule settings)
//   questions.xlsx  — Sample questions (one sheet per subject, 5 questions each)

const XLSX = require('xlsx'); // SheetJS library for creating Excel files
const path = require('path'); // Path module for file paths

// ============================================
// 1. Create config.xlsx — Subject configuration
// ============================================
function createConfig() {
  // Config data: one row per subject with schedule settings
  // Topic_Thread_ID is blank — will be filled by setup.js after creating Telegram topics
  const configData = [
    {
      'Subject': 'Polity',           // Must match a sheet name in questions.xlsx
      'Emoji': '⚖️',                 // Emoji for the Telegram topic title
      'Topic_Thread_ID': '',          // Filled by setup.js — leave empty for now
      'Schedule_Cron': '0 */2 * * *', // Every 2 hours
      'Questions_Per_Batch': 5,       // Send 5 questions per batch
      'Active': 'YES'                 // Schedule is active
    },
    {
      'Subject': 'Economy',
      'Emoji': '💰',
      'Topic_Thread_ID': '',
      'Schedule_Cron': '0 */3 * * *', // Every 3 hours
      'Questions_Per_Batch': 5,
      'Active': 'YES'
    },
    {
      'Subject': 'History',
      'Emoji': '📜',
      'Topic_Thread_ID': '',
      'Schedule_Cron': '0 9,18 * * *', // Twice daily at 9 AM and 6 PM
      'Questions_Per_Batch': 5,
      'Active': 'YES'
    },
    {
      'Subject': 'Geography',
      'Emoji': '🌍',
      'Topic_Thread_ID': '',
      'Schedule_Cron': '0 */3 * * *',
      'Questions_Per_Batch': 5,
      'Active': 'YES'
    },
    {
      'Subject': 'Science',
      'Emoji': '🔬',
      'Topic_Thread_ID': '',
      'Schedule_Cron': '0 */2 * * *',
      'Questions_Per_Batch': 5,
      'Active': 'YES'
    },
    {
      'Subject': 'Current Affairs',
      'Emoji': '📰',
      'Topic_Thread_ID': '',
      'Schedule_Cron': '0 8,14,20 * * *', // Three times a day
      'Questions_Per_Batch': 3,
      'Active': 'YES'
    }
  ];

  // Create workbook and worksheet
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(configData);

  // Set column widths
  ws['!cols'] = [
    { wch: 20 },  // Subject
    { wch: 8 },   // Emoji
    { wch: 18 },  // Topic_Thread_ID
    { wch: 22 },  // Schedule_Cron
    { wch: 22 },  // Questions_Per_Batch
    { wch: 8 }    // Active
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Config');
  XLSX.writeFile(wb, 'config.xlsx');
  console.log('✅ Created: config.xlsx (6 subjects configured)');
}

// ============================================
// 2. Create questions.xlsx — Sample questions (one sheet per subject)
// ============================================
function createQuestions() {
  const wb = XLSX.utils.book_new(); // Create a new workbook

  // ---- Polity Questions (Sheet 1) ----
  const polityData = [
    {
      'Question': 'Who is known as the Father of the Indian Constitution?',
      'Option A': 'Mahatma Gandhi',
      'Option B': 'Dr. B.R. Ambedkar',
      'Option C': 'Jawaharlal Nehru',
      'Option D': 'Sardar Patel',
      'Correct Answer': 'B',
      'Explanation': 'Dr. B.R. Ambedkar chaired the Drafting Committee of the Constitution.',
      'Posted': ''  // Empty = not posted yet
    },
    {
      'Question': 'The Preamble was amended by which amendment?',
      'Option A': '42nd Amendment',
      'Option B': '44th Amendment',
      'Option C': '52nd Amendment',
      'Option D': '61st Amendment',
      'Correct Answer': 'A',
      'Explanation': '42nd Amendment (1976) added Socialist, Secular, Integrity.',
      'Posted': ''
    },
    {
      'Question': 'Which Article deals with Right to Equality?',
      'Option A': 'Article 12',
      'Option B': 'Article 14',
      'Option C': 'Article 19',
      'Option D': 'Article 21',
      'Correct Answer': 'B',
      'Explanation': 'Article 14 guarantees equality before law.',
      'Posted': ''
    },
    {
      'Question': 'Fundamental Duties were borrowed from which country?',
      'Option A': 'USA',
      'Option B': 'UK',
      'Option C': 'USSR',
      'Option D': 'France',
      'Correct Answer': 'C',
      'Explanation': 'Fundamental Duties were borrowed from the USSR Constitution.',
      'Posted': ''
    },
    {
      'Question': 'How many schedules are in the Indian Constitution?',
      'Option A': '8',
      'Option B': '10',
      'Option C': '12',
      'Option D': '14',
      'Correct Answer': 'C',
      'Explanation': 'The Indian Constitution currently has 12 schedules.',
      'Posted': ''
    }
  ];
  addSheet(wb, 'Polity', polityData);

  // ---- Economy Questions (Sheet 2) ----
  const economyData = [
    {
      'Question': 'Which body formulates monetary policy in India?',
      'Option A': 'NITI Aayog',
      'Option B': 'Finance Ministry',
      'Option C': 'RBI',
      'Option D': 'SEBI',
      'Correct Answer': 'C',
      'Explanation': 'Reserve Bank of India (RBI) formulates monetary policy.',
      'Posted': ''
    },
    {
      'Question': 'What does GDP stand for?',
      'Option A': 'Gross Domestic Product',
      'Option B': 'General Domestic Price',
      'Option C': 'Gross Development Plan',
      'Option D': 'General Development Product',
      'Correct Answer': 'A',
      'Explanation': 'GDP = Gross Domestic Product, total value of goods and services.',
      'Posted': ''
    },
    {
      'Question': 'Which Five Year Plan is known as the Mahalanobis Plan?',
      'Option A': 'First',
      'Option B': 'Second',
      'Option C': 'Third',
      'Option D': 'Fourth',
      'Correct Answer': 'B',
      'Explanation': 'The Second Five Year Plan (1956-61) was the Mahalanobis Plan.',
      'Posted': ''
    },
    {
      'Question': 'GST was introduced in India in which year?',
      'Option A': '2015',
      'Option B': '2016',
      'Option C': '2017',
      'Option D': '2018',
      'Correct Answer': 'C',
      'Explanation': 'GST was implemented on July 1, 2017.',
      'Posted': ''
    },
    {
      'Question': 'NABARD is associated with which sector?',
      'Option A': 'Industrial',
      'Option B': 'Agricultural',
      'Option C': 'Service',
      'Option D': 'Mining',
      'Correct Answer': 'B',
      'Explanation': 'NABARD focuses on agriculture and rural development.',
      'Posted': ''
    }
  ];
  addSheet(wb, 'Economy', economyData);

  // ---- History Questions (Sheet 3) ----
  const historyData = [
    {
      'Question': 'Battle of Plassey was fought in which year?',
      'Option A': '1757',
      'Option B': '1764',
      'Option C': '1857',
      'Option D': '1947',
      'Correct Answer': 'A',
      'Explanation': 'Battle of Plassey (1757) established British rule in India.',
      'Posted': ''
    },
    {
      'Question': 'Who founded the Indian National Congress?',
      'Option A': 'Mahatma Gandhi',
      'Option B': 'A.O. Hume',
      'Option C': 'Dadabhai Naoroji',
      'Option D': 'Bal Gangadhar Tilak',
      'Correct Answer': 'B',
      'Explanation': 'Allan Octavian Hume founded INC in 1885.',
      'Posted': ''
    },
    {
      'Question': 'Jallianwala Bagh massacre happened in which year?',
      'Option A': '1917',
      'Option B': '1919',
      'Option C': '1920',
      'Option D': '1921',
      'Correct Answer': 'B',
      'Explanation': 'Jallianwala Bagh massacre took place on April 13, 1919.',
      'Posted': ''
    },
    {
      'Question': 'Who gave the slogan "Inquilab Zindabad"?',
      'Option A': 'Subhas Chandra Bose',
      'Option B': 'Bhagat Singh',
      'Option C': 'Lala Lajpat Rai',
      'Option D': 'Chandrashekhar Azad',
      'Correct Answer': 'B',
      'Explanation': 'Bhagat Singh popularized "Inquilab Zindabad".',
      'Posted': ''
    },
    {
      'Question': 'The Quit India Movement was launched in which year?',
      'Option A': '1940',
      'Option B': '1942',
      'Option C': '1944',
      'Option D': '1946',
      'Correct Answer': 'B',
      'Explanation': 'Quit India Movement started on August 8, 1942.',
      'Posted': ''
    }
  ];
  addSheet(wb, 'History', historyData);

  // ---- Geography Questions (Sheet 4) ----
  const geographyData = [
    {
      'Question': 'Which is the longest river in India?',
      'Option A': 'Yamuna',
      'Option B': 'Ganga',
      'Option C': 'Godavari',
      'Option D': 'Brahmaputra',
      'Correct Answer': 'B',
      'Explanation': 'Ganga (2,525 km) is the longest river in India.',
      'Posted': ''
    },
    {
      'Question': 'The highest peak in India is?',
      'Option A': 'Mount Everest',
      'Option B': 'Kangchenjunga',
      'Option C': 'K2',
      'Option D': 'Nanda Devi',
      'Correct Answer': 'B',
      'Explanation': 'Kangchenjunga (8,586m) is the highest peak entirely in India.',
      'Posted': ''
    },
    {
      'Question': 'Which soil is ideal for cotton cultivation?',
      'Option A': 'Alluvial',
      'Option B': 'Red soil',
      'Option C': 'Black soil',
      'Option D': 'Laterite',
      'Correct Answer': 'C',
      'Explanation': 'Black soil (Regur) is ideal for cotton cultivation.',
      'Posted': ''
    },
    {
      'Question': 'The Tropic of Cancer passes through how many Indian states?',
      'Option A': '6',
      'Option B': '8',
      'Option C': '10',
      'Option D': '12',
      'Correct Answer': 'B',
      'Explanation': 'Tropic of Cancer passes through 8 Indian states.',
      'Posted': ''
    },
    {
      'Question': 'Which Indian state has the longest coastline?',
      'Option A': 'Gujarat',
      'Option B': 'Maharashtra',
      'Option C': 'Tamil Nadu',
      'Option D': 'Andhra Pradesh',
      'Correct Answer': 'A',
      'Explanation': 'Gujarat has the longest coastline (~1,600 km).',
      'Posted': ''
    }
  ];
  addSheet(wb, 'Geography', geographyData);

  // ---- Science Questions (Sheet 5) ----
  const scienceData = [
    {
      'Question': 'What is the chemical formula of water?',
      'Option A': 'H2O',
      'Option B': 'CO2',
      'Option C': 'NaCl',
      'Option D': 'O2',
      'Correct Answer': 'A',
      'Explanation': 'Water is composed of 2 hydrogen + 1 oxygen atom (H2O).',
      'Posted': ''
    },
    {
      'Question': 'Which planet is known as the Red Planet?',
      'Option A': 'Venus',
      'Option B': 'Jupiter',
      'Option C': 'Mars',
      'Option D': 'Saturn',
      'Correct Answer': 'C',
      'Explanation': 'Mars appears red due to iron oxide on its surface.',
      'Posted': ''
    },
    {
      'Question': 'What is the unit of electric current?',
      'Option A': 'Volt',
      'Option B': 'Watt',
      'Option C': 'Ohm',
      'Option D': 'Ampere',
      'Correct Answer': 'D',
      'Explanation': 'Electric current is measured in Amperes (A).',
      'Posted': ''
    },
    {
      'Question': 'Which vitamin is produced by sunlight in the human body?',
      'Option A': 'Vitamin A',
      'Option B': 'Vitamin B',
      'Option C': 'Vitamin C',
      'Option D': 'Vitamin D',
      'Correct Answer': 'D',
      'Explanation': 'Vitamin D is synthesized when skin is exposed to sunlight.',
      'Posted': ''
    },
    {
      'Question': 'The nucleus of an atom contains?',
      'Option A': 'Protons and Electrons',
      'Option B': 'Protons and Neutrons',
      'Option C': 'Neutrons and Electrons',
      'Option D': 'Only Protons',
      'Correct Answer': 'B',
      'Explanation': 'The nucleus contains protons (+ve) and neutrons (neutral).',
      'Posted': ''
    }
  ];
  addSheet(wb, 'Science', scienceData);

  // ---- Current Affairs Questions (Sheet 6) ----
  const currentAffairsData = [
    {
      'Question': 'Which country hosted the G20 Summit in 2023?',
      'Option A': 'Japan',
      'Option B': 'India',
      'Option C': 'Indonesia',
      'Option D': 'Brazil',
      'Correct Answer': 'B',
      'Explanation': 'India hosted the G20 Summit in New Delhi in September 2023.',
      'Posted': ''
    },
    {
      'Question': 'Chandrayaan-3 successfully landed on the Moon in which year?',
      'Option A': '2022',
      'Option B': '2023',
      'Option C': '2024',
      'Option D': '2025',
      'Correct Answer': 'B',
      'Explanation': 'Chandrayaan-3 landed on Aug 23, 2023, at the lunar south pole.',
      'Posted': ''
    },
    {
      'Question': 'Who is the current Chief Justice of India (2025)?',
      'Option A': 'N.V. Ramana',
      'Option B': 'D.Y. Chandrachud',
      'Option C': 'Sanjiv Khanna',
      'Option D': 'U.U. Lalit',
      'Correct Answer': 'C',
      'Explanation': 'Justice Sanjiv Khanna is the CJI since November 2024.',
      'Posted': ''
    },
    {
      'Question': 'Aditya-L1 mission is related to which celestial body?',
      'Option A': 'Moon',
      'Option B': 'Mars',
      'Option C': 'Sun',
      'Option D': 'Venus',
      'Correct Answer': 'C',
      'Explanation': 'Aditya-L1 is ISRO\'s mission to study the Sun.',
      'Posted': ''
    },
    {
      'Question': 'Which state became the 29th state of India in 2014?',
      'Option A': 'Uttarakhand',
      'Option B': 'Jharkhand',
      'Option C': 'Telangana',
      'Option D': 'Chhattisgarh',
      'Correct Answer': 'C',
      'Explanation': 'Telangana was carved out of Andhra Pradesh on June 2, 2014.',
      'Posted': ''
    }
  ];
  addSheet(wb, 'Current Affairs', currentAffairsData);

  // Write the workbook to disk
  XLSX.writeFile(wb, 'questions.xlsx');
  console.log('✅ Created: questions.xlsx (6 sheets, 5 questions each = 30 total)');
}

/**
 * addSheet — Helper to create a worksheet and add it to the workbook.
 * Sets standard column widths for readability.
 *
 * @param {Object} wb — Workbook to add the sheet to
 * @param {string} name — Sheet name (must match subject name in config.xlsx)
 * @param {Array} data — Array of row objects
 */
function addSheet(wb, name, data) {
  const ws = XLSX.utils.json_to_sheet(data);

  // Set column widths for comfortable viewing in Excel
  ws['!cols'] = [
    { wch: 60 },  // Question
    { wch: 30 },  // Option A
    { wch: 30 },  // Option B
    { wch: 30 },  // Option C
    { wch: 30 },  // Option D
    { wch: 15 },  // Correct Answer
    { wch: 50 },  // Explanation
    { wch: 30 }   // Posted
  ];

  XLSX.utils.book_append_sheet(wb, ws, name);
}

// ============================================
// Run
// ============================================
console.log('');
console.log('📁 Creating sample Excel files...');
console.log('');

createConfig();    // Create config.xlsx with subject settings
createQuestions();  // Create questions.xlsx with sample questions

console.log('');
console.log('📋 Next steps:');
console.log('   1. Edit config.xlsx — Set your subject names and schedule preferences');
console.log('   2. Edit questions.xlsx — Add your actual APPSC questions in each sheet');
console.log('   3. Fill in .env with your Telegram bot token and group ID');
console.log('   4. Run: node setup.js — Creates Telegram topics for each subject');
console.log('   5. Run: node send.js --stats — Check question counts');
console.log('   6. Run: node send.js --subject Polity --count 5 — Send questions!');
console.log('');
