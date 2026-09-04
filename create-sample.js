// ============================================================================
// create-sample.js — Generates config.xlsx and questions.xlsx for 16 APPSC Subjects
// ============================================================================
// This script creates the complete Excel tracking files for all 16 subjects requested by the user:
// 1. History (📜)
// 2. AP History (🏛️)
// 3. Geography (🌍)
// 4. AP Geography (🗺️)
// 5. Economy (💰)
// 6. AP Economy (📈)
// 7. Polity (⚖️)
// 8. Society (👥)
// 9. Current Affairs (📰)
// 10. Science and Technology (🚀)
// 11. Biology (🧬)
// 12. Chemistry (🧪)
// 13. Physics (⚛️)
// 14. Environment (🌿)
// 15. General Studies (📚)
// 16. Disaster Management (🛡️)
//
// Where changes are seen:
// - Generates a new config.xlsx with 16 rows and schedule settings
// - Generates a new questions.xlsx with 16 dedicated worksheets and realistic APPSC MCQs
// ============================================================================

// Import SheetJS XLSX library for reading and writing Excel spreadsheets
const XLSX = require('xlsx');
// Import path module to handle cross-platform file path resolution
const path = require('path');

/**
 * createConfig — Generates the config.xlsx workbook containing all 16 subject configurations.
 * What it does: Creates rows with subject names, icons/emojis, empty thread IDs, and scheduling rules.
 * What it brings: Provides setup.js and schedule.js with the necessary metadata for each channel.
 * Where changes can be seen: In config.xlsx root spreadsheet.
 */
function createConfig() {
  // Array of 16 subject configurations tailored for APPSC examination preparation
  const configData = [
    {
      // Subject 1: Indian History
      'Subject': 'History',
      // Topic emoji icon to visually distinguish the forum topic in Telegram
      'Emoji': '📜',
      // Telegram Topic Thread ID will be populated automatically by setup.js
      'Topic_Thread_ID': '',
      // Cron expression: runs daily at 9:00 AM and 6:00 PM
      'Schedule_Cron': '0 9,18 * * *',
      // Number of questions dispatched in each scheduled batch
      'Questions_Per_Batch': 5,
      // Active flag to enable automated schedule dispatching
      'Active': 'YES'
    },
    {
      // Subject 2: Andhra Pradesh History & Culture
      'Subject': 'AP History',
      // Visual emoji icon representing AP historical monuments
      'Emoji': '🏛️',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 3 hours
      'Schedule_Cron': '0 */3 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 3: General & Indian Geography
      'Subject': 'Geography',
      // Globe emoji for geography topic
      'Emoji': '🌍',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 3 hours
      'Schedule_Cron': '0 */3 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 4: Andhra Pradesh State Geography
      'Subject': 'AP Geography',
      // Map emoji for state geography topic
      'Emoji': '🗺️',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 3 hours
      'Schedule_Cron': '0 */3 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 5: Indian Economy & Planning
      'Subject': 'Economy',
      // Money bag emoji for Indian economy topic
      'Emoji': '💰',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 3 hours
      'Schedule_Cron': '0 */3 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 6: Andhra Pradesh State Economy & Schemes
      'Subject': 'AP Economy',
      // Growth chart emoji for AP state economy topic
      'Emoji': '📈',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 3 hours
      'Schedule_Cron': '0 */3 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 7: Indian Polity & Constitution
      'Subject': 'Polity',
      // Scales of justice emoji for Indian polity
      'Emoji': '⚖️',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 2 hours
      'Schedule_Cron': '0 */2 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 8: Indian & AP Society, Social Issues & Welfare
      'Subject': 'Society',
      // People group emoji for society topics
      'Emoji': '👥',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 4 hours
      'Schedule_Cron': '0 */4 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 9: National, International & State Current Affairs
      'Subject': 'Current Affairs',
      // Newspaper emoji for current affairs
      'Emoji': '📰',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs three times daily at 8 AM, 2 PM, 8 PM
      'Schedule_Cron': '0 8,14,20 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 10: Science & Technology and Innovations
      'Subject': 'Science and Technology',
      // Rocket emoji for science & tech
      'Emoji': '🚀',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 3 hours
      'Schedule_Cron': '0 */3 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 11: Biological Sciences & Human Health
      'Subject': 'Biology',
      // DNA strand emoji for biological sciences
      'Emoji': '🧬',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 4 hours
      'Schedule_Cron': '0 */4 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 12: Chemical Sciences & Everyday Chemistry
      'Subject': 'Chemistry',
      // Test tube emoji for chemistry
      'Emoji': '🧪',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 4 hours
      'Schedule_Cron': '0 */4 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 13: Physical Sciences
      'Subject': 'Physics',
      // Atom symbol emoji for physics
      'Emoji': '⚛️',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 4 hours
      'Schedule_Cron': '0 */4 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 14: Environment, Ecology & Climate Change
      'Subject': 'Environment',
      // Herb/leaf emoji for environment topic
      'Emoji': '🌿',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 3 hours
      'Schedule_Cron': '0 */3 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 15: General Studies & Mental Ability
      'Subject': 'General Studies',
      // Books emoji for general studies
      'Emoji': '📚',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 3 hours
      'Schedule_Cron': '0 */3 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    },
    {
      // Subject 16: Disaster Management & Mitigation
      'Subject': 'Disaster Management',
      // Shield emoji for disaster protection and management
      'Emoji': '🛡️',
      // Topic thread ID populated after Telegram forum creation
      'Topic_Thread_ID': '',
      // Cron expression: runs every 4 hours
      'Schedule_Cron': '0 */4 * * *',
      // Batch question count
      'Questions_Per_Batch': 5,
      // Active flag
      'Active': 'YES'
    }
  ];

  // Initialize a fresh SheetJS workbook instance
  const wb = XLSX.utils.book_new();
  // Convert JSON subject configuration array into an Excel worksheet
  const ws = XLSX.utils.json_to_sheet(configData);

  // Define readable column widths for Excel spreadsheet viewers
  ws['!cols'] = [
    { wch: 26 },  // Subject name width
    { wch: 8 },   // Emoji symbol width
    { wch: 20 },  // Topic Thread ID width
    { wch: 22 },  // Cron schedule expression width
    { wch: 22 },  // Questions per batch width
    { wch: 10 }   // Active state column width
  ];

  // Append the configured worksheet named "Config" to the workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Config');
  // Write the file to disk as config.xlsx in the project root directory
  XLSX.writeFile(wb, 'config.xlsx');
  // Output success confirmation message to the terminal console
  console.log('✅ Created: config.xlsx (16 subjects configured with emojis & cron)');
}

/**
 * addSheet — Helper to format and add an array of questions as an Excel worksheet.
 * What it does: Converts question objects to a tabular sheet with standardized column formatting.
 * What it brings: Uniform structure across all 16 subject sheets in questions.xlsx.
 * Where changes can be seen: Individual tabs within questions.xlsx.
 *
 * @param {Object} wb - SheetJS workbook instance
 * @param {string} name - Name of the worksheet matching the subject exactly
 * @param {Array<Object>} data - Array of question row objects
 */
function addSheet(wb, name, data) {
  // Convert raw question objects into an Excel worksheet structure
  const ws = XLSX.utils.json_to_sheet(data);

  // Set standard column widths for clean readability in Excel or Google Sheets
  ws['!cols'] = [
    { wch: 65 },  // Question prompt column
    { wch: 30 },  // Option A column
    { wch: 30 },  // Option B column
    { wch: 30 },  // Option C column
    { wch: 30 },  // Option D column
    { wch: 16 },  // Correct answer letter (A/B/C/D)
    { wch: 60 },  // Detailed explanation text
    { wch: 25 }   // Posted timestamp status tracker
  ];

  // Attach worksheet with subject name to the main workbook
  XLSX.utils.book_append_sheet(wb, ws, name);
}

/**
 * createQuestions — Generates the questions.xlsx workbook with sample questions for each of the 16 subjects.
 * What it does: Populates standard APPSC multiple-choice questions with 4 options, answers, and explanations.
 * What it brings: Immediate working test questions ready for quiz polls.
 * Where changes can be seen: In questions.xlsx with 16 distinct worksheets.
 */
function createQuestions() {
  // Create a new Excel workbook instance for questions
  const wb = XLSX.utils.book_new();

  // 1. History Questions
  addSheet(wb, 'History', [
    {
      'Question': 'Who was the Governor-General of India during the Revolt of 1857?',
      'Option A': 'Lord Dalhousie',
      'Option B': 'Lord Canning',
      'Option C': 'Lord Curzon',
      'Option D': 'Lord William Bentinck',
      'Correct Answer': 'B',
      'Explanation': 'Lord Canning served as the Governor-General during 1857 and became India’s first Viceroy under the Government of India Act 1858.',
      'Posted': ''
    },
    {
      'Question': 'The Indian National Congress passed the "Poorna Swaraj" resolution in which session?',
      'Option A': '1929 Lahore Session',
      'Option B': '1920 Nagpur Session',
      'Option C': '1931 Karachi Session',
      'Option D': '1906 Calcutta Session',
      'Correct Answer': 'A',
      'Explanation': 'The Poorna Swaraj (Complete Independence) declaration was passed at the Lahore Session presided over by Jawaharlal Nehru in December 1929.',
      'Posted': ''
    }
  ]);

  // 2. AP History Questions
  addSheet(wb, 'AP History', [
    {
      'Question': 'Who was the greatest ruler among the Satavahana dynasty of Andhra?',
      'Option A': 'Simuka',
      'Option B': 'Gautamiputra Satakarni',
      'Option C': 'Yajna Sri Satakarni',
      'Option D': 'Pulumavi II',
      'Correct Answer': 'B',
      'Explanation': 'Gautamiputra Satakarni (23rd ruler) was the greatest Satavahana monarch, renowned by the Nasik inscription of Gautami Balasri.',
      'Posted': ''
    },
    {
      'Question': 'Which Kakatiya ruler built the famous Thousand Pillar Temple in Hanumakonda?',
      'Option A': 'Rudradeva (Prataparudra I)',
      'Option B': 'Ganapati Deva',
      'Option C': 'Rani Rudrama Devi',
      'Option D': 'Prataparudra II',
      'Correct Answer': 'A',
      'Explanation': 'Rudradeva constructed the Thousand Pillar Temple at Hanumakonda in 1163 AD dedicated to Shiva, Vishnu, and Surya.',
      'Posted': ''
    }
  ]);

  // 3. Geography Questions
  addSheet(wb, 'Geography', [
    {
      'Question': 'Which is the largest freshwater lake in India?',
      'Option A': 'Chilika Lake',
      'Option B': 'Wular Lake',
      'Option C': 'Vembanad Lake',
      'Option D': 'Loktak Lake',
      'Correct Answer': 'B',
      'Explanation': 'Wular Lake in Jammu & Kashmir is the largest freshwater lake in India, fed by the Jhelum River.',
      'Posted': ''
    },
    {
      'Question': 'The "Ten Degree Channel" separates which of the following islands?',
      'Option A': 'Andaman and Nicobar',
      'Option B': 'Minicoy and Maldives',
      'Option C': 'Little Andaman and Car Nicobar',
      'Option D': 'Lakshadweep and Minicoy',
      'Correct Answer': 'A',
      'Explanation': 'The Ten Degree Channel separates the Andaman Islands from the Nicobar Islands in the Bay of Bengal.',
      'Posted': ''
    }
  ]);

  // 4. AP Geography Questions
  addSheet(wb, 'AP Geography', [
    {
      'Question': 'What is the length of the coastline of Andhra Pradesh, ranking second in mainland India?',
      'Option A': '974 km',
      'Option B': '1,050 km',
      'Option C': '850 km',
      'Option D': '1,200 km',
      'Correct Answer': 'A',
      'Explanation': 'Andhra Pradesh has the second longest mainland coastline in India with an approximate length of 974 km.',
      'Posted': ''
    },
    {
      'Question': 'Which of the following is the highest peak in Andhra Pradesh and the Eastern Ghats?',
      'Option A': 'Arma Konda (Jindhagada)',
      'Option B': 'Mahendragiri',
      'Option C': 'Horsley Hills',
      'Option D': 'Nallamala Hills',
      'Correct Answer': 'A',
      'Explanation': 'Arma Konda (Jindhagada Peak) at 1,680 m elevation in the Eastern Ghats of AP is the highest peak in the state.',
      'Posted': ''
    }
  ]);

  // 5. Economy Questions
  addSheet(wb, 'Economy', [
    {
      'Question': 'Which index is primarily used by the Reserve Bank of India (RBI) to measure headline retail inflation?',
      'Option A': 'Wholesale Price Index (WPI)',
      'Option B': 'Consumer Price Index - Combined (CPI-C)',
      'Option C': 'Index of Industrial Production (IIP)',
      'Option D': 'GDP Deflator',
      'Correct Answer': 'B',
      'Explanation': 'Under the flexible inflation targeting framework, the RBI uses Consumer Price Index (CPI-Combined) as its primary inflation measure.',
      'Posted': ''
    },
    {
      'Question': 'The Fiscal Responsibility and Budget Management (FRBM) Act was enacted in which year in India?',
      'Option A': '2001',
      'Option B': '2003',
      'Option C': '2005',
      'Option D': '2008',
      'Correct Answer': 'B',
      'Explanation': 'The FRBM Act was enacted in 2003 to ensure inter-generational equity in fiscal management and long-term macro-economic stability.',
      'Posted': ''
    }
  ]);

  // 6. AP Economy Questions
  addSheet(wb, 'AP Economy', [
    {
      'Question': 'Which sector contributes the highest share to the Gross State Value Added (GSVA) in Andhra Pradesh?',
      'Option A': 'Agriculture & Allied Sectors',
      'Option B': 'Manufacturing Industry',
      'Option C': 'Services Sector',
      'Option D': 'Mining and Quarrying',
      'Correct Answer': 'A',
      'Explanation': 'In Andhra Pradesh, Agriculture & Allied sectors (especially aquaculture and horticulture) contribute substantially higher share (~35-40%) to GSVA.',
      'Posted': ''
    },
    {
      'Question': 'The Visakhapatnam-Chennai Industrial Corridor (VCIC) is supported and co-funded by which multilateral bank?',
      'Option A': 'World Bank',
      'Option B': 'Asian Development Bank (ADB)',
      'Option C': 'Asian Infrastructure Investment Bank (AIIB)',
      'Option D': 'New Development Bank (NDB)',
      'Correct Answer': 'B',
      'Explanation': 'The Asian Development Bank (ADB) is the lead partner and financier for developing the VCIC in Andhra Pradesh.',
      'Posted': ''
    }
  ]);

  // 7. Polity Questions
  addSheet(wb, 'Polity', [
    {
      'Question': 'Which Constitutional Amendment Act is known as the "Mini-Constitution"?',
      'Option A': '42nd Amendment Act 1976',
      'Option B': '44th Amendment Act 1978',
      'Option C': '73rd Amendment Act 1992',
      'Option D': '86th Amendment Act 2002',
      'Correct Answer': 'A',
      'Explanation': 'The 42nd Amendment Act (1976) introduced extensive changes across the Preamble, Fundamental Duties, and DPSP, earning the title Mini-Constitution.',
      'Posted': ''
    },
    {
      'Question': 'Under which Article can the President of India declare Financial Emergency?',
      'Option A': 'Article 352',
      'Option B': 'Article 356',
      'Option C': 'Article 360',
      'Option D': 'Article 365',
      'Correct Answer': 'C',
      'Explanation': 'Article 360 empowers the President to proclaim a Financial Emergency if the financial stability or credit of India is threatened.',
      'Posted': ''
    }
  ]);

  // 8. Society Questions
  addSheet(wb, 'Society', [
    {
      'Question': 'Who among the following introduced the concept of "Sanskritization" in Indian Sociology?',
      'Option A': 'G.S. Ghurye',
      'Option B': 'M.N. Srinivas',
      'Option C': 'Andre Beteille',
      'Option D': 'Iravati Karve',
      'Correct Answer': 'B',
      'Explanation': 'Prof. M.N. Srinivas coined "Sanskritization" to explain the cultural mobility process among Indian caste hierarchies.',
      'Posted': ''
    },
    {
      'Question': 'Under which Article of the Constitution are special safeguards provided for Scheduled Castes and Scheduled Tribes?',
      'Option A': 'Article 15(4) and Article 16(4)',
      'Option B': 'Article 25 and 26',
      'Option C': 'Article 19(1)(a)',
      'Option D': 'Article 21A',
      'Correct Answer': 'A',
      'Explanation': 'Articles 15(4) and 16(4) enable the State to make special provisions and affirmative action for the advancement of SCs, STs, and SEBCs.',
      'Posted': ''
    }
  ]);

  // 9. Current Affairs Questions
  addSheet(wb, 'Current Affairs', [
    {
      'Question': 'Which country hosted the G20 Leaders Summit under the 2024 presidency?',
      'Option A': 'India',
      'Option B': 'Brazil',
      'Option C': 'South Africa',
      'Option D': 'Italy',
      'Correct Answer': 'B',
      'Explanation': 'Brazil assumed the G20 Presidency from India for 2024, hosting the leaders summit in Rio de Janeiro.',
      'Posted': ''
    },
    {
      'Question': 'Which scheme was launched by the AP government to provide financial assistance to women self-help groups?',
      'Option A': 'YSR Aasara',
      'Option B': 'YSR Cheyutha',
      'Option C': 'YSR Sunna Vaddi',
      'Option D': 'All of the above',
      'Correct Answer': 'D',
      'Explanation': 'All three schemes (YSR Aasara, Cheyutha, and Sunna Vaddi) target economic empowerment of SHG women in Andhra Pradesh.',
      'Posted': ''
    }
  ]);

  // 10. Science and Technology Questions
  addSheet(wb, 'Science and Technology', [
    {
      'Question': 'Which rocket launch vehicle was used by ISRO for the historic Chandrayaan-3 lunar mission?',
      'Option A': 'PSLV-C56',
      'Option B': 'GSLV-Mk II',
      'Option C': 'LVM3-M4',
      'Option D': 'SSLV-D2',
      'Correct Answer': 'C',
      'Explanation': 'Chandrayaan-3 was successfully launched on July 14, 2023, aboard ISRO’s Launch Vehicle Mark-3 (LVM3-M4).',
      'Posted': ''
    },
    {
      'Question': 'What is the name of India’s first indigenous human spaceflight mission?',
      'Option A': 'Aditya-L1',
      'Option B': 'Gaganyaan',
      'Option C': 'Shukrayaan',
      'Option D': 'Mangalyaan-2',
      'Correct Answer': 'B',
      'Explanation': 'Gaganyaan is ISRO’s human spaceflight program intended to send astronauts to low earth orbit.',
      'Posted': ''
    }
  ]);

  // 11. Biology Questions
  addSheet(wb, 'Biology', [
    {
      'Question': 'Which organelle is universally known as the "Powerhouse of the Cell"?',
      'Option A': 'Ribosome',
      'Option B': 'Mitochondria',
      'Option C': 'Golgi Apparatus',
      'Option D': 'Lysosome',
      'Correct Answer': 'B',
      'Explanation': 'Mitochondria generate adenosine triphosphate (ATP), the chemical energy currency of eukaryotic cells.',
      'Posted': ''
    },
    {
      'Question': 'Which vitamin deficiency leads to the condition known as Night Blindness (Nyctalopia)?',
      'Option A': 'Vitamin A (Retinol)',
      'Option B': 'Vitamin B1 (Thiamine)',
      'Option C': 'Vitamin C (Ascorbic Acid)',
      'Option D': 'Vitamin D (Calciferol)',
      'Correct Answer': 'A',
      'Explanation': 'Vitamin A deficiency affects the synthesis of rhodopsin pigment in rods of the retina, resulting in night blindness.',
      'Posted': ''
    }
  ]);

  // 12. Chemistry Questions
  addSheet(wb, 'Chemistry', [
    {
      'Question': 'What is the chemical name and formula of Baking Soda?',
      'Option A': 'Sodium Carbonate (Na2CO3)',
      'Option B': 'Sodium Hydrogen Carbonate (NaHCO3)',
      'Option C': 'Sodium Hydroxide (NaOH)',
      'Option D': 'Calcium Carbonate (CaCO3)',
      'Correct Answer': 'B',
      'Explanation': 'Baking soda is Sodium Bicarbonate or Sodium Hydrogen Carbonate with formula NaHCO3.',
      'Posted': ''
    },
    {
      'Question': 'Which gas is primarily responsible for the greenhouse effect and ocean acidification?',
      'Option A': 'Methane (CH4)',
      'Option B': 'Carbon Dioxide (CO2)',
      'Option C': 'Nitrous Oxide (N2O)',
      'Option D': 'Sulfur Dioxide (SO2)',
      'Correct Answer': 'B',
      'Explanation': 'CO2 dissolution in seawater forms carbonic acid, lowering seawater pH and causing ocean acidification.',
      'Posted': ''
    }
  ]);

  // 13. Physics Questions
  addSheet(wb, 'Physics', [
    {
      'Question': 'What is the SI unit of Electric Current?',
      'Option A': 'Volt',
      'Option B': 'Ohm',
      'Option C': 'Ampere',
      'Option D': 'Watt',
      'Correct Answer': 'C',
      'Explanation': 'Ampere (symbol A) is the base SI unit of electric current named after André-Marie Ampère.',
      'Posted': ''
    },
    {
      'Question': 'Which optical phenomenon explains the brilliant sparkle and brilliance of a cut diamond?',
      'Option A': 'Diffraction',
      'Option B': 'Total Internal Reflection (TIR)',
      'Option C': 'Polarization',
      'Option D': 'Interference',
      'Correct Answer': 'B',
      'Explanation': 'The high refractive index of diamond (~2.42) causes a very small critical angle (~24.4°), trapping light through Total Internal Reflection.',
      'Posted': ''
    }
  ]);

  // 14. Environment Questions
  addSheet(wb, 'Environment', [
    {
      'Question': 'Koleru Lake, a designated Ramsar Wetland site, is situated in which state?',
      'Option A': 'Odisha',
      'Option B': 'Andhra Pradesh',
      'Option C': 'Tamil Nadu',
      'Option D': 'Kerala',
      'Correct Answer': 'B',
      'Explanation': 'Kolleru Lake is situated between Krishna and Godavari deltas in Andhra Pradesh and is a designated Ramsar site of international importance.',
      'Posted': ''
    },
    {
      'Question': 'The "Montreal Protocol" signed in 1987 is related to the protection of which of the following?',
      'Option A': 'Wetlands conservation',
      'Option B': 'Ozone Layer preservation',
      'Option C': 'Hazardous waste transboundary movement',
      'Option D': 'Endangered species trade',
      'Correct Answer': 'B',
      'Explanation': 'The Montreal Protocol phased out the production of numerous substances responsible for ozone depletion (CFCs, halons).',
      'Posted': ''
    }
  ]);

  // 15. General Studies Questions
  addSheet(wb, 'General Studies', [
    {
      'Question': 'Under the Andhra Pradesh Reorganisation Act 2014, how many districts were originally in the bifurcated State of Andhra Pradesh?',
      'Option A': '10',
      'Option B': '13',
      'Option C': '26',
      'Option D': '23',
      'Correct Answer': 'B',
      'Explanation': 'At bifurcation in June 2014, Andhra Pradesh comprised 13 districts (which were later restructured into 26 in April 2022).',
      'Posted': ''
    },
    {
      'Question': 'Which statutory body in India conducts public examinations for recruitment to civil services in Andhra Pradesh?',
      'Option A': 'UPSC',
      'Option B': 'APPSC',
      'Option C': 'SSC',
      'Option D': 'NTA',
      'Correct Answer': 'B',
      'Explanation': 'The Andhra Pradesh Public Service Commission (APPSC), constituted under Article 315 of the Constitution, conducts state civil recruitment.',
      'Posted': ''
    }
  ]);

  // 16. Disaster Management Questions
  addSheet(wb, 'Disaster Management', [
    {
      'Question': 'Who serves as the ex-officio Chairperson of the National Disaster Management Authority (NDMA) in India?',
      'Option A': 'Union Home Minister',
      'Option B': 'Prime Minister of India',
      'Option C': 'President of India',
      'Option D': 'Cabinet Secretary',
      'Correct Answer': 'B',
      'Explanation': 'Under the Disaster Management Act 2005, the Prime Minister of India is the ex-officio Chairperson of the NDMA.',
      'Posted': ''
    },
    {
      'Question': 'Which colored weather warning issued by the IMD indicates "Take Action" for imminent extreme events like cyclones?',
      'Option A': 'Yellow',
      'Option B': 'Orange',
      'Option C': 'Red',
      'Option D': 'Green',
      'Correct Answer': 'C',
      'Explanation': 'Red warning issued by the India Meteorological Department (IMD) requires disaster authorities and citizens to take immediate action.',
      'Posted': ''
    }
  ]);

  // Save the entire workbook with all 16 subject worksheets into questions.xlsx
  XLSX.writeFile(wb, 'questions.xlsx');
  // Log confirmation showing total subject sheets created
  console.log('✅ Created: questions.xlsx (16 subject sheets created with standard APPSC questions)');
}

// Execute the generation of configuration and question files
console.log('🚀 Generating 16 APPSC subjects configuration and question databases...');
// Build subject configuration spreadsheet
createConfig();
// Build questions spreadsheet with 16 sheets
createQuestions();
console.log('✨ All files successfully generated!');
