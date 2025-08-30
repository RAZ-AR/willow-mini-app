// Google Apps Script for Willow Coffee Cards Sheet Integration
// This script handles automatic card registration to the Cards sheet

function doPost(e) {
  try {
    // Parse the incoming data
    const data = JSON.parse(e.postData.contents);
    
    // Get the spreadsheet and Cards sheet
    const spreadsheetId = '1BRQuzea6bba0NxxPk9koLSzpHkfiAzrKmwDa8ow7128';
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = spreadsheet.getSheetByName('Cards');
    
    // If Cards sheet doesn't exist, create it
    if (!sheet) {
      const newSheet = spreadsheet.insertSheet('Cards');
      // Add headers
      newSheet.getRange(1, 1, 1, 4).setValues([['id', 'card', 'name', 'telegram']]);
      newSheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    }
    
    const cardsSheet = spreadsheet.getSheetByName('Cards');
    
    // Check if card already exists
    const existingData = cardsSheet.getDataRange().getValues();
    const existingCard = existingData.find(row => row[0] == data.id);
    
    if (existingCard) {
      return ContentService
        .createTextOutput(JSON.stringify({success: true, message: 'Card already exists'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Add new row with card data
    cardsSheet.appendRow([
      data.id,        // telegram_id
      data.card,      // card_number  
      data.name,      // full_name
      data.telegram   // username or telegram_id
    ]);
    
    return ContentService
      .createTextOutput(JSON.stringify({success: true, message: 'Card added successfully'}))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({success: false, error: error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Test function for manual testing
function testAddCard() {
  const testData = {
    id: 123456789,
    card: 5678,
    name: "Test User",
    telegram: "testuser"
  };
  
  const mockEvent = {
    postData: {
      contents: JSON.stringify(testData)
    }
  };
  
  const result = doPost(mockEvent);
  console.log(result.getContent());
}