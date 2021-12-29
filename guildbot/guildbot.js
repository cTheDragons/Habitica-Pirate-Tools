/*

This code is licensed under the same terms as Habitica:
    https://raw.githubusercontent.com/HabitRPG/habitrpg/develop/LICENSE


Contributors:
    cTheDragons https://github.com/cTheDragons

Desgin notes:
This design of the bot has been created so that you run for  
    * All guilds
    * One guild only (for testing, or required refresh)

The code deliberately uses setTimeout functions to slow the code down. Trello API 7 Habitica has hard limits on how many times it can be called. (https://help.trello.com/article/838-api-rate-limits). All calls are routed to makeAxiosCall to handle these timeouts. To make the most, calls are sent in bulk and the looped through. The success and failure counts look at ajaxRunningCount to determine if moves on to the next section.

The code is broken into three parts, with parts 1 and 2 looping till all data has been refreshed.

# 1st Part - Fetch Base Data
    * Fetch Base data, all cards, all guilds, user data, config data from Trello and Pirate Cove Guild data. (function fetchBaseData)
    * Join any guilds that are missing (function postCreateAllMissingCards)
    * Create any cards that are missing
    * Process Pirate Cove chat (function postCommentCoveAll) 
    Code will stop if the last Cove message Id is missing.


# 2nd part for each card
Then for each card, if the card Due Date has passed, or the leader is bot leader, or if asked to run specific card. 
(Each time we run, we only do the first valid gConfig.testchunk cards to avoid memory issues).
- Determine if the card should be tested (add to ajaxRunningCount_guildsToTest)
- Fetch the guild and leader information and Update the extra fields. Each subsection is controlled by cFieldsStatus to avoid processing twice.
- Test the card if needs to change list/hail etc (function testCard - cFieldStatus4 - creates cActionStatus) 
- Hail the Guild if required and update Custom fields and Update Description of card if required and update Due Date (Should be at least 1 day in the future) Each subsection is controlled by cActionStatus to avoid processing twice.
Loop 1st and 2nd Part till no further changes are done.

# 3rd Part - Reporting
- Update if habit if completed full or single guild loop
- Cron (so the bot updates the last login date).
- The send report to Cove if correct time of day
- Update stat files


Dates:
    * All entered and compared in UTC timezone
    * It is assumed that this process would run once a day around the same time.
    * Time is not added to DueDate so if the process is run slightly earlier the next day, it will still be updated.
    * Time is not added to Hailed (Date) for when the guild is moved into logListIdTargetSpotted so if the process is run slightly earlier the next day, it will still be moved to the correct list.
    * Time is not added to Guild Created as it this to represent the card was made, not when the guild was actually created.
    * Once per week a report is produced to the Cove, if all guilds are updated. If this process is to run multiple times per day, this logic will need to be altered as it only reports on guilds that are selected. Often if the process has already been run once a day it will state there is nothing to report.


Card Position
    * When a card is new it will stay at the top of the list
    * If the card moves from one list to the other it will move to the top of the list
    * All other cards will hold position

*/


//////////////////////////////////////////////////////////////////////
////   External Function (Require)                   /////////////////
//////////////////////////////////////////////////////////////////////
var moment = require('moment');
var axios = require('axios');
var _ = require('lodash');
var fs = require('fs');

module.exports = {
completeRun: function  (modeEnvironment, testOnlyThisGuild, botId, botToken, botAuthUser, botAuthPassword, logId, logToken){

//////////////////////////////////////////////////////////////////////
////   Global Constants                              /////////////////
//////////////////////////////////////////////////////////////////////
const DOUBLEQUOTES = 		'"' //This is to make my life easier... 
const SINGLEQUOTE =       "'"
const ESCAPECHAR =        "\\"

const environment = modeEnvironment || 'production';
const config = require('./config.json');
const defaultConfig = config.production;
const environmentConfig = config[environment];
const gConfig = _.merge(defaultConfig, environmentConfig);

//Text used for Pirate reports, logs etc (not hails)
const configText = require('./configText.json');
const defaultConfigText = configText.production;
const environmentConfigText = configText[environment];
const gConfigText = _.merge(defaultConfigText, environmentConfigText);

if ((botId != '') || (botId != undefined)){
    gConfig.botId = botId
    gConfig.botToken = botToken
    gConfig.logId = logId
    gConfig.logToken = logToken 
    gConfig.botAuthUser = botAuthUser
    gConfig.botAuthPassword = botAuthPassword    
}

//Transalation of label names to json tags.
const gConfigCatLabelTranslate = require('./configCatLabelTranslate.json');

//////////////////////////////////////////////////////////////////////
////   Global External Reports      //////////////////////////////
//////////////////////////////////////////////////////////////////////
//These are stated here as they should never change.
gConfig.journalGus =  gConfig.folderstat + '/' + gConfig.outputFilePrefix + 'gus.json' //GUS Files
gConfig.journalStats = gConfig.folderstat + '/' + gConfig.outputFilePrefix + 'stats.json' //stats of pirate bot
gConfig.journalPirate = gConfig.folderstat + '/' + gConfig.outputFilePrefix + 'pirate.json' //list of all challenges for the Elves
gConfig.journalElf = gConfig.folderstat + '/' + gConfig.outputFilePrefix + 'elf.json' //list of all challenges for the Elves

//Output Logs
gConfig.journalMaster = gConfig.folderoutput +  '/' + gConfig.outputFilePrefix + 'masterList.json' //all guilds to test
gConfig.outputLogSingleFile = gConfig.folderoutput +  '/' + gConfig.outputFilePrefix + 'outputSingleShip.txt'
gConfig.outputLogPrefix = gConfig.folderoutput +  '/' + gConfig.outputFilePrefix + 'output'


//////////////////////////////////////////////////////////////////////
////   Global Config Variables      //////////////////////////////////
//////////////////////////////////////////////////////////////////////
gConfig.chatMessageLengthMaxCove    = gConfig.chatMessageLengthMax - gConfig.chatMessageLengthReserved //Need to add parts at the top

gConfig.dateNextETJustLaunched      = moment().utc().add((gConfig.dayETJustLaunched - gConfig.dayBetweenReports)*-1, "days").format("D MMM YYYY")
gConfig.dateNextETTargetSpotted     = moment().utc().add((gConfig.dayETTargetSpotted - gConfig.dayBetweenReports)*-1, 'days')
gConfig.dateHailReview              = moment().utc().add(gConfig.dayHailReview * -1, 'days').format('D MMM YYYY')
gConfig.dateNextNoReponse           = moment().utc().add(gConfig.dayETNoResponse_LastRites*-1, 'days').format('D MMM YYYY')


//BoardURL
gConfig.logServerPathBoard = gConfig.logServerPathBoardPart + gConfig.logServerPathBoardId

//URL if an Error in Chat botGuildError should be a Guild Error
gConfig.urlToErrorChatGuild = gConfig.botServerUrl + gConfig.botServerPathGroup + '/' + gConfig.botGuildError  + gConfig.botServerPathChat


//Trello Custom fields
// get this https://developers.trello.com/reference/#boardsidcustomfields
//ids will be populated later therefore moving out of gConfig
logCustomFields = gConfig.logCustomFields
logCustomFields_justId = Object.keys(logCustomFields)

//////////////////////////////////////////////////////////////////////
////   Global Variables                              /////////////////
//////////////////////////////////////////////////////////////////////
var content;  	// holds site-wide content (gear names and stats, quests, etc)
var user;    	 // holds user's data
var guilds;	// holds all guilds data
var guilds_justId // holds only the guild ids so they can be searched.
var guildsJoined;  // hold guilds joined so to know which card to add them too
var guildsSunk; //holds guilds sunk during list
var guildsBotLeader; //holds the guilds id where the leader is the bot
var guildsForceUpdate; //holds the guilds id that different to the masterList data and needs to update (To slow to check all the cards)

var guildsLatestData; //holds the list of guilds data to be updated.
var guildsHasAdmiralReportLabel = [] //hold list of guilds that have Admrial Label (Stops looping)

var reportWarningFastMoving; //holds the guilds that guilds from High activity from Hail
var reportWarningAlmostInTheOcean; //holds for where the hail is almost in the Ocean 
var reportWarningReHail; //holds guilds that guilds from require rehail.
var reportWarningNoRoster; //holds the guilds id that has missing Sky Blue Category (Reported at the end)
var reportWarningOverRoster; //holds the guilds id that has more than one Sky Blue Category (Reported at the end)
var reportWarningOverRoster_Label; //object array holds each label for report. 


var userIsAdmin; //holds if the user is an Admin or not
var cards; // holds trello cards 
var cards_justId // holds only the guilds ids so they can be easily searched.
var labels;
var labels_allLanguages = []; //array of blue language labels
var lists; //holds the lists of trello.

//Will get each of these labels when getting each of the language labels
var logLabelDNHOfficial = ''        
var logLabelNonEnglishHail = ''
var logLabelCallForLastRites = ''   
var logLabelCallForReHail = ''
var logLabelCallForDropAnchor = ''
var logLabelSailToBermudaTriangle = ''
var logLabelRemoveActiveComment = ''


var logLabelAllLanguages = ''
var logLabelDropAnchor = ''
var logLabelAdmiralReport = ''



//Trello Lists -- Will each from upload
// get this list by calling https://developers.trello.com/reference/#boardsboardidlists
var logListIdJustLaunched       = ''
var logListIdClearSailing       = ''
var logListIdTargetSpotted      = ''
var logListIdCaptainMIA         = ''
var logListIdCaptured           = ''
var logListIdLastRites          = ''
var logListIdDoNotHail          = ''
var logListIdBermudaTriangle    = ''
var logListIdPrivateNavy        = ''
var logListIdSunk               = ''



var logCardConfig = ''

var actionTakenInLoop // True or false if new items were added.
var clearCountLoad = 0 //Forces the Clear Sailing not to bunch up

var guildCove; //holds the pirate cove data
var cardConfig; //holds config data

var masterList = {} //master list
var hailLang = {} // Lanaguages for all Hails


//stats of run
var streamConsole //stream for writing to output file.

var retryAttempt = 0 //holds number of retries attempt
var retryAttempt_hailed = 0

var totalGuilds = {}
totalGuilds['tested'] = {}
totalGuilds.tested['total'] = 0
totalGuilds.tested['fullAttempt'] = 1 // this is different as retryAttempts may fail on base data load.

//To monitor API Timeouts
var rl = gConfig.rl

//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
////   Start here                                    /////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////

//init file
consoleLogInitFile(moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSS') + '\n')
if (gConfig.debugConsole) console.log(moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSS'))

if (gConfig.debug) consoleLogToFile('debug START Guild Bot complete run');

guildsLatestData = {}
guildsJoined = []
guildsSunk = []
reportWarningFastMoving = []
reportWarningAlmostInTheOcean = []
reportWarningReHail = []

//Load Master data to compare
var fileContents = fs.readFileSync(gConfig.journalMaster, 'utf-8');
var tempBox = JSON.parse(fileContents)
masterList = tempBox.guild

//Load Language Hails
gConfig.hailLangAvail.forEach(function (obj, index){
    var filepath = gConfig.folderLang + obj + '/' + gConfig.fileLang

    var fileContents = fs.readFileSync(filepath, 'utf-8')
    var tempBox = JSON.parse(fileContents)
    hailLang[obj] = tempBox
});



fetchBaseData()


///////////////////////////////////////////////////////////////
////   Get base data                              ////////////
//////////////////////////////////////////////////////////////	
function fetchBaseData(){
    if (gConfig.debugConsole) console.log('fetchBaseData Retry attempt: ' + retryAttempt);
    if (gConfig.debug) consoleLogToFile('fetchBaseData START');
    if (gConfig.debug) consoleLogToFile('********************************************');
    if (gConfig.debug) consoleLogToFile('********************************************');
    if (gConfig.debug) consoleLogToFile('********************************************');
    if (gConfig.debug) consoleLogToFile('********************************************');
    if (gConfig.debug) consoleLogToFile('Retry attempt: ' + retryAttempt);
    if (gConfig.debug) consoleLogToFile('********************************************');
    if (gConfig.debug) consoleLogToFile('********************************************');
    if (gConfig.debug) consoleLogToFile('********************************************');
    if (gConfig.debug) consoleLogToFile('********************************************');

    totalGuilds.tested['attempt' + totalGuilds.tested.fullAttempt ] = 0

    var ajaxRunningCount = 9
    retryAttempt_hailed = 0 //reset if failed before
    actionTakenInLoop = false
	if (gConfig.debug) consoleLogToFile('Action Taken set to false')
	
    retryAttempt++
	if (retryAttempt < gConfig.retryAttemptMax){
		
		//Habitica Data
        var call = []

        //User Data     
        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataUser START');
        var urlToAction = gConfig.botServerUrl + gConfig.botServerPathUser
        var newData = {}
        var item = {}
        call.push({targetType: 'bot', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: fetchBaseDataUser_Success, fnFailure: fetchBaseData_Failure, item: item})

        //Guild Data
        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataGuild START');
        var urlToAction = gConfig.botServerUrl + gConfig.botServerPathGroup
        var newData = {type: "publicGuilds,privateGuilds"}
        var item = {}
        call.push({targetType: 'bot', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: fetchBaseDataGuild_Success, fnFailure: fetchBaseData_Failure, item: item})

        //Cove Data
        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataCove START');
        var urlToAction = gConfig.botServerUrl + gConfig.botServerPathGroup + '/' + gConfig.botGuildCove
        var newData = {}
        var item = {}
        call.push({targetType: 'bot', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: fetchBaseDataCove_Success, fnFailure: fetchBaseData_Failure, item: item})

        makeAxiosCall(_.cloneDeep(call))

		//Trello Data
        call = []

        //Labels Data
        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataLabels START');
        var urlToAction = gConfig.logServerUrl + gConfig.logServerPathBoard + gConfig.logServerPathLabels 
        var newData = {limit: '1000'} 
        var item = {}
        call.push({targetType: 'log', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: fetchBaseDataLabels_Success, fnFailure: fetchBaseData_Failure, item: item})
        

        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataCustomFields START');
        var urlToAction = gConfig.logServerUrl + gConfig.logServerPathBoard + gConfig.logServerPathCustFields
        var newData = {}
        var item = {}
        call.push({targetType: 'log', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: fetchBaseDataCustomFields_Success, fnFailure: fetchBaseData_Failure, item: item})

        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataCardList START');
        var urlToAction = gConfig.logServerUrl + gConfig.logServerPathBoard + gConfig.logServerPathCards 
        var newData = {}
        var item = {}
        call.push({targetType: 'log', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: fetchBaseDataCardList_Success, fnFailure: fetchBaseData_Failure, item: item})
        
        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataConfigCardList START');
        var urlToAction = gConfig.logServerUrl + gConfig.logServerPathBoard + gConfig.logServerPathList
        var newData = {}
        var item = {}
        call.push({targetType: 'log', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: fetchBaseDataConfigCardList_Success, fnFailure: fetchBaseData_Failure, item: item})

        makeAxiosCall(_.cloneDeep(call))

	} else {
        consoleLogToFile('******************************************')
        consoleLogToFile('******************************************')
        consoleLogToFile('******************************************')
        consoleLogToFile('** Thats it! I have become sea sick!   ***')
        consoleLogToFile('**         Too many retries.           ***')
        consoleLogToFile('******************************************')
        consoleLogToFile('******************************************')
        consoleLogToFile('******************************************')
        consoleLogToFile('******************************************')

    }


    function fetchBaseDataUser_Success(data, item){
        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataUser_Success SUCCESS')

        user = data
        userIsAdmin = false;
        if (user.contributor != undefined){
            if (user.contributor.admin) userIsAdmin = true
        }

        ajaxRunningCount--
        if (ajaxRunningCount == 0) fetchBaseData_Comp()
    }

    function fetchBaseDataGuild_Success(data, item){
        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataGuild_Success SUCCESS')

        guilds = data

        ajaxRunningCount--
        if (ajaxRunningCount == 0) fetchBaseData_Comp()
    }

    function fetchBaseDataCove_Success(data, item){
        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataCove_Success SUCCESS')

        guildCove = data

        ajaxRunningCount--
        if (ajaxRunningCount == 0) fetchBaseData_Comp()
    }


    function fetchBaseDataLabels_Success(data, item){
        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataLabels_Success SUCCESS')

        labels = data

        labels_allLanguages = [] //Clear before redoing

        labels.forEach(function(obj,index){
            if (obj.color == gConfig.labelColour_Language) labels_allLanguages.push(obj.id)
         
            //Set ids for specific lavel ids.
            switch(obj.name){
            case gConfig.logLabelDNHOfficialName:
                logLabelDNHOfficial = obj.id
                break;
            case gConfig.logLabelNonEnglishHailName: 
                logLabelNonEnglishHail = obj.id
            case gConfig.logLabelCallForLastRitesName:
                logLabelCallForLastRites = obj.id
                break;
            case gConfig.logLabelCallForReHailName:
                logLabelCallForReHail = obj.id
                break; 
            case gConfig.logLabelCallForDropAnchorName:
                logLabelCallForDropAnchor = obj.id
                break;                                       
            case gConfig.logLabelAllLanguagesName:
                logLabelAllLanguages = obj.id
                break;
            case gConfig.logLabelDropAnchorName:
                logLabelDropAnchor = obj.id
                break; 
            case gConfig.logLabelSailToBermudaTriangleName:
                logLabelSailToBermudaTriangle = obj.id
                break;
            case gConfig.logLabelAdmiralReportName:
                logLabelAdmiralReport = obj.id
                break;
            case gConfig.logLabelRemoveActiveCommentName:
                logLabelRemoveActiveComment = obj.id
                break;
            } 
        });
    
        ajaxRunningCount--
        if (ajaxRunningCount == 0) fetchBaseData_Comp()
    }

    function fetchBaseDataCustomFields_Success(data, item){
        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataCustomFields_Success SUCCESS')

        var tempBox = data

        logCustomFields_justId.forEach(function(obj,index){
            tempBox.forEach(function (obj2, index2){
                if (obj2.name == logCustomFields[obj].name) logCustomFields[obj].id = obj2.id
            });
        });

        ajaxRunningCount--
        if (ajaxRunningCount == 0) fetchBaseData_Comp()

        ajaxRunningCount--
        if (ajaxRunningCount == 0) fetchBaseData_Comp()
    }


    function fetchBaseDataCardList_Success(data, item){
        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataCardList_Success SUCCESS')

        cards = data

        //find Config Card
        cards.forEach(function (obj, index){
            if (obj.name == gConfig.logCardConfigName) logCardConfig = obj.id
        });

        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataConfigCardCustomFieldsSTART');
        var call = []
        var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + logCardConfig + gConfig.logServerPathAllCustField
        var newData = {}
        var item = {}
        call.push({targetType: 'log', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: fetchBaseDataConfigCardCustomFields_Success, fnFailure: fetchBaseData_Failure, item: item})
        makeAxiosCall(_.cloneDeep(call))

        ajaxRunningCount--
        if (ajaxRunningCount == 0) fetchBaseData_Comp()
    }


    function fetchBaseDataConfigCardCustomFields_Success(data, item){
        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataConfigCardCustomFields_Success SUCCESS')

        cardConfig = data

        ajaxRunningCount--
        if (ajaxRunningCount == 0) fetchBaseData_Comp()
    }

    function fetchBaseDataConfigCardList_Success(data, item){
        if (gConfig.debug) consoleLogToFile('debug fetchBaseDataConfigCardList_Success SUCCESS')

        lists = data

        lists.forEach( function(obj,index){
            
            //Set ids for specific lavel ids.
            switch(obj.name){
            case gConfig.logListIdJustLaunchedName:
                logListIdJustLaunched = obj.id
                break;
            case gConfig.logListIdClearSailingName:
                logListIdClearSailing = obj.id
                break;
            case gConfig.logListIdTargetSpottedName:
                logListIdTargetSpotted = obj.id
                break; 
            case gConfig.logListIdCaptainMIAName:
                logListIdCaptainMIA = obj.id
                break;                                       
            case gConfig.logListIdCapturedName:
                logListIdCaptured = obj.id
                break;
            case gConfig.logListIdLastRitesName:
                logListIdLastRites = obj.id
                break; 
            case gConfig.logListIdDoNotHailName:
                logListIdDoNotHail = obj.id
                break;
            case gConfig.logListIdBermudaTriangleName:
                logListIdBermudaTriangle = obj.id
                break;
            case gConfig.logListIdPrivateNavyName:
                logListIdPrivateNavy = obj.id
                break;
            case gConfig.logListIdSunkName:
                logListIdSunk = obj.id
                break;
            } 

        });

        ajaxRunningCount--
        if (ajaxRunningCount == 0) fetchBaseData_Comp()
    }



    function fetchBaseData_Failure(response, item, urlTo){
            consoleLogToFile('debug fetchBaseData_Failure ******** ERROR for ' + urlTo)
 
            consoleLogToFile('***********************************************************')
            consoleLogToFile('***********************************************************')
            consoleLogToFile('        UNABLE TO COMPLETE. SEE ERROR ABOVE')
            consoleLogToFile('  ' + urlTo)
            consoleLogToFile('***********************************************************')
            consoleLogToFile('***********************************************************')
            consoleLogToFile('***********************************************************')
            consoleLogToFile('***********************************************************')
    }



    function fetchBaseData_Comp(){
        if (gConfig.debug) consoleLogToFile('debug fetchBaseData_Comp START');

        if (gConfig.debug) consoleLogToFile('JustLaunched: ' + logListIdJustLaunched)
        if (gConfig.debug) consoleLogToFile('ClearSailing: ' + logListIdClearSailing)
        if (gConfig.debug) consoleLogToFile('TargetSpotted: ' + logListIdTargetSpotted)
        if (gConfig.debug) consoleLogToFile('CaptainMIA: ' + logListIdCaptainMIA)
        if (gConfig.debug) consoleLogToFile('Captured: ' + logListIdCaptured)
        if (gConfig.debug) consoleLogToFile('LastRites: ' + logListIdLastRites)
        if (gConfig.debug) consoleLogToFile('DoNotHail: ' + logListIdDoNotHail)
        if (gConfig.debug) consoleLogToFile('BermudaTriangle: ' + logListIdBermudaTriangle)
        if (gConfig.debug) consoleLogToFile('PrivateNavy: ' + logListIdPrivateNavy)
        if (gConfig.debug) consoleLogToFile('Sunk: ' + logListIdSunk)

        var allCustomFieldsPopulated = true

        logCustomFields_justId.forEach(function (obj, index){
            if (obj.id == ''){
                allCustomFieldsPopulated = false
                consoleLogToFile ('Custom field ' + obj.name + '  id is missing. (Check Field has not been renamed)')    
            }
        });

        
        if (allCustomFieldsPopulated == false){
            //This should be the first test so is shows correctly in the logs.
            consoleLogToFile ('ALL CUSTOM FIELDS ID NOT POPULATED - CANNOT CONTINUE ')
            consoleLog ('ALL CUSTOM FIELDS ID NOT POPULATED - CANNOT CONTINUE ')
        } else if (
            (logLabelDNHOfficial == '') ||
            (logLabelNonEnglishHail == '') ||
            (logLabelCallForLastRites == '') ||
            (logLabelCallForReHail == '') ||
            (logLabelAllLanguages == '') ||
            (logLabelCallForDropAnchor == '') ||
            (logLabelSailToBermudaTriangle == '') ||
            (logLabelDropAnchor == '') ||
            (logLabelRemoveActiveComment == '')  
        ){
            consoleLogToFile('UNABLE TO FIND ALL LABELS. CHECK LABELS HAVE NOT BEEN RENAMED.')
            consoleLogToFile('DNHOfficial: ' + logLabelDNHOfficial)
            consoleLogToFile('NonEnglishHail: ' + logLabelNonEnglishHail)
            consoleLogToFile('CallForLastRites: ' + logLabelCallForLastRites)
            consoleLogToFile('CallForRehail: ' + logLabelCallForReHail)
            consoleLogToFile('CallForDropAnchor: ' + logLabelCallForDropAnchor)
            consoleLogToFile('SailToBermudaTriangle: ' + logLabelSailToBermudaTriangle)
            consoleLogToFile('AllLanguages: ' + logLabelAllLanguages)
            consoleLogToFile('DropAnchor: ' + logLabelDropAnchor)
            consoleLogToFile('RemoveActiveComment: ' + logLabelRemoveActiveComment)

            if (gConfig.debugConsole) console.log('UNABLE TO FIND ALL LABELS. CHECK LABELS HAVE NOT BEEN RENAMED.')
        } else if (
            (logListIdJustLaunched == '') ||
            (logListIdClearSailing == '') ||
            (logListIdTargetSpotted == '') ||
            (logListIdCaptainMIA == '') ||
            (logListIdCaptured == '') ||
            (logListIdLastRites == '') ||
            (logListIdDoNotHail == '') ||
            (logListIdBermudaTriangle == '') ||
            (logListIdPrivateNavy == '') ||
            (logListIdSunk == '')  
        ){
            consoleLogToFile('UNABLE TO FIND ALL LISTS. CHECK LISTS HAVE NOT BEEN RENAMED (and they match the config file)')
            consoleLogToFile('JustLaunched: ' + logListIdJustLaunched)
            consoleLogToFile('ClearSailing: ' + logListIdClearSailing)
            consoleLogToFile('TargetSpotted: ' + logListIdTargetSpotted)
            consoleLogToFile('CaptainMIA: ' + logListIdCaptainMIA)
            consoleLogToFile('Captured: ' + logListIdCaptured)
            consoleLogToFile('LastRites: ' + logListIdLastRites)
            consoleLogToFile('DoNotHail: ' + logListIdDoNotHail)
            consoleLogToFile('BermudaTriangle: ' + logListIdBermudaTriangle)
            consoleLogToFile('PrivateNavy: ' + logListIdPrivateNavy)
            consoleLogToFile('Sunk: ' + logListIdSunk)

            if (gConfig.debugConsole) console.log('UNABLE TO FIND ALL LISTS. CHECK LISTS HAVE NOT BEEN RENAMED.')
        } else if (logCardConfig == ''){
            consoleLogToFile('CONFIG CARD HAS BEEN RENAMED. CANNOT FIND.')
            if (gConfig.debugConsole) console.log('CONFIG CARD HAS BEEN RENAMED. CANNOT FIND.')
        } else {
            if (gConfig.debug) consoleLogToFile('No of Guilds:' + guilds.length) 
            if (gConfig.debug) consoleLogToFile('No of Cards:' + cards.length) 
            postJoinAllGuilds() 
        }
         
        if (gConfig.debug) consoleLogToFile('debug fetchBaseData_Comp END');
    }
}


//////////////////////////////////////////////////////////////////////
////   Join All Guilds                             /////////////////
//////////////////////////////////////////////////////////////////////
function postJoinAllGuilds(){
    if (gConfig.debug) consoleLogToFile('debug postJoinAllGuilds START');
    //Need to join to ensure able to capture guilds.
    
    var ajaxRunningCount = guilds.length
    

    guilds_justId = [] //reset data
    guildsBotLeader = []
    guildsForceUpdate = []
    reportWarningNoRoster = []
    reportWarningOverRoster = []
    reportWarningOverRoster_Label = {}

    var call = []
    guilds.forEach(function(obj, index){
        guilds_justId.push(obj._id)

        //Test if lead by the bot
        if (obj.leader == gConfig.botId){
            if (gConfig.debug) consoleLogToFile(obj._id + '  is lead by the bot')
            guildsBotLeader.push(obj._id)
        }


        //test if a Force Update needed
        if ((testOnlyThisGuild == '')  && (obj._id != gConfig.botGuildTavernAlt) && (obj._id != gConfig.botGuildTavern)){
            if (masterList[obj._id] != undefined){
                if ((masterList[obj._id].leader != undefined) || (masterList[obj._id].name != undefined)){
                    if (
                            (masterList[obj._id].leader.trim() != obj.leader.trim()) || 
                            (masterList[obj._id].name.trim() != obj.name.trim()) || 
                            (masterList[obj._id].privacy != obj.privacy) ||
                            (masterList[obj._id].created == undefined) ||
                            (moment(masterList[obj._id].created).isSameOrBefore(gConfig.masterDateCheckTo)) ||
                            ( //Count test either percentage or gold position
        /*  Not required - Refreshed enough as is.                    
                                (
                                    (masterList[obj._id].memberCount >= obj.memberCount * (1+masterCountCheckPercent)) ||
                                    (masterList[obj._id].memberCount <= obj.memberCount * (1-masterCountCheckPercent)) 
                                ) ||
        */                        
                                (
                                    (masterList[obj._id].memberCount >= gConfig.guildColourGold) &&
                                    (obj.memberCount < gConfig.guildColourGold) 
                                ) ||
                                (
                                    (masterList[obj._id].memberCount < gConfig.guildColourGold) &&
                                    (obj.memberCount >= gConfig.guildColourGold) 
                                ) ||
                                (
                                    (masterList[obj._id].memberCount >= gConfig.guildColourSilver) &&
                                    (obj.memberCount < gConfig.guildColourSilver) 
                                ) ||
                                (
                                    (masterList[obj._id].memberCount < gConfig.guildColourSilver) &&
                                    (obj.memberCount >= gConfig.guildColourSilver) 
                                )

                            ) || 
                            (
                                (
                                    (masterList[obj._id].summary != obj.summary) &&
                                    (obj.summary != undefined) 
                                ) || 
                                (
                                    ((masterList[obj._id].summary != '') && masterList[obj._id].summary != masterList[obj._id].name) &&
                                    (obj.summary == undefined) 
                                )
                            )){
                            guildsForceUpdate.push(obj._id)
                        }
                } else {
                    guildsForceUpdate.push(obj._id)
                }
            } else {
               masterList[obj._id] = {} //Add empty object
               guildsJoined.push(obj._id)
            }
            
            //Force update of Member count
            masterList[obj._id].memberCount = obj.memberCount
        }

        
        //Ok now do we need to change the guilds?
        if ((user.guilds.indexOf(obj._id) < 0) && (obj._id != gConfig.botGuildTavernAlt) && (obj._id != gConfig.botGuildTavern)){
            actionTakenInLoop = true 
			if (gConfig.debug) consoleLogToFile('Action Taken. Set to Loop again')

            var guildId = obj._id
            if (gConfig.debug) consoleLogToFile('debug postJoinGuild START for ' + guildId);
            var urlToAction = gConfig.botServerUrl + gConfig.botServerPathGroup + '/' + guildId + gConfig.botServerPathGroupJoin 
            var newData = {}
            var item = {guildId: guildId}
            call.push({targetType: 'bot', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postJoinGuild_Success, fnFailure: postJoinGuild_Failure, item: item})
            if (guildsForceUpdate.indexOf(guildId) < 0) guildsForceUpdate.push(guildId)

        } else {
            ajaxRunningCount--
            if (ajaxRunningCount == 0) postJoinAllGuilds_Comp()
        }    
    });
    if (call.length > 0) makeAxiosCall(_.cloneDeep(call))

    function postJoinGuild_Success(data, item){
        consoleLogToFile('debug postJoinGuild SUCCESS for ' + item.guildId)
            
        ajaxRunningCount--
        if (ajaxRunningCount == 0) postJoinAllGuilds_Comp()
    }

    function postJoinGuild_Failure(response, item, urlTo){
            consoleLogToFile('postJoinGuild ******** ERROR for ' + urlTo)

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postJoinAllGuilds_Comp()
    }

    function postJoinAllGuilds_Comp(){
        if (gConfig.debug) consoleLogToFile('debug postJoinAllGuilds_Comp START');
        postCreateAllMissingCards()
        if (gConfig.debug) consoleLogToFile('debug postJoinAllGuilds_Comp END');  
    }

    if (gConfig.debug) consoleLogToFile('debug postJoinAllGuilds END');
}

//////////////////////////////////////////////////////////////////////
////   Create Missing Cards                          /////////////////
//////////////////////////////////////////////////////////////////////
function postCreateAllMissingCards(){
    if (gConfig.debug) consoleLogToFile('debug postCreateAllMissingCards START');
    //Just create the cards with todays due date. The data will be updated later.
    ajaxRunningCount = guilds.length
    cards_justId = []
    var call = [] //We are not holidng up coding till it all done.

    cards.forEach(function(obj, index){
        //Test for duplicates here
        if (cards_justId.indexOf(obj.name) < 0){
            cards_justId.push(obj.name)
        } else {
            //Call Delete Card!
            actionTakenInLoop = true
            if (gConfig.debug) consoleLogToFile('Action Taken. Set to Loop again')
            
            var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + obj.id
            var newData = {
                closed: true
            } 
            var item = {
                cardId: obj.id
            }
            call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToActionD, newData: newDataD, fnSuccess: postDeleteCard_Success, fnFailure: postDeleteCard_Failure, item: itemD})
        }
    });

    if (call.length > 0){
        makeAxiosCall(_.cloneDeep(call)) 
        call = []  
    }

    var call = [] //start a new array in case we are deleting cards in the background
    
    guilds.forEach(function(obj, index){
        if ((cards_justId.indexOf(obj._id) <  0) && (obj._id != gConfig.botGuildTavernAlt) && (obj._id != gConfig.botGuildTavern)){
            actionTakenInLoop = true 
			if (gConfig.debug) consoleLogToFile('Action Taken. Set to Loop again')			
            
            var cardListId = logListIdJustLaunched
            if (gConfig.initialLoad){
                cardListId = logListIdClearSailing
                if (guildsJoined.indexOf(obj._id) >= 0) cardListId = logListIdJustLaunched
            } 
            if (obj.privacy != 'public') cardListId = logListIdPrivateNavy
     
            var guildId = obj._id
            if (gConfig.debug) consoleLogToFile('debug postCreateCard START for ' + guildId);
            actionTakenInLoop = true
            if (gConfig.debug) consoleLogToFile('Action Taken. Set to Loop again')
            
            var dueDate = moment().utc().format('YYYY-MM-DD') //make it today so it will be updated with the next fetch.

            var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards
            var newData = {
                name: guildId,
                desc: 'NEW CARD WILL UPDATE SOON',
                pos: 'top',
                due: dueDate,
                dueComplete: 'false',
                idList: cardListId
            } 
            var item = {
                guildId: guildId
            }
            call.push({targetType: 'log', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postCreateCard_Success, fnFailure: postCreateCard_Failure, item: item})
            
        } else {
            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCreateAllMissingCardsComp()
        }    
    });
    if (call.length > 0){
        makeAxiosCall(_.cloneDeep(call)) 
        call = []  
    }

    //////////////////////////////////////////////////////////////////////
    ////   Delete  Cards (for Duplicates)                     
    //////////////////////////////////////////////////////////////////////
    function postDeleteCard_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postDeleteCard SUCCESS for ' + item.cardId)
			// No further action needed
        }
        
        
    function postDeleteCard_Failure(response, item, urlTo){
            consoleLogToFile('postDeleteCard ******** ERROR for ' + urlTo)
    } //postDeleteCard


    //////////////////////////////////////////////////////////////////////
    ////   Create  Cards                      
    //////////////////////////////////////////////////////////////////////
    function postCreateCard_Success(data, item){
        if (gConfig.debug) consoleLogToFile('debug postCreateCard SUCCESS for ' + item.guildId)

        //quick attach the 3 urls without waiting
        var cardId = data.id
        var guildId = item.guildId


        if (gConfig.debug) consoleLogToFile('debug postAttachmentUrl START for ' + guildId);

        var call = []

        var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cardId +  gConfig.logServerPathAttachments
        var newData = {
            name: 'Guild Data Tool: Just Chat & Leader',
            url: gConfig.habiticaGuildToolUrl + guildId + gConfig.habiticaGuildToolPathNone
        }  
        var item = {guildId: guildId, urlToAttach: gConfig.habiticaGuildToolUrl + guildId + gConfig.habiticaGuildToolPathNone}
        call.push({targetType: 'log', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postAttachmentUrl_Success, fnFailure: postAttachmentUrl_Failure, item: item})
        
        var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cardId +  gConfig.logServerPathAttachments
        var newData = {
            name: 'Guild Data Tool: All Members',
            url: gConfig.habiticaGuildToolUrl + guildId + gConfig.habiticaGuildToolPathAll
        }  
        var item = {guildId: guildId, urlToAttach: gConfig.habiticaGuildToolUrl + guildId + gConfig.habiticaGuildToolPathAll}
        call.push({targetType: 'log', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postAttachmentUrl_Success, fnFailure: postAttachmentUrl_Failure, item: item})
        
        var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cardId +  gConfig.logServerPathAttachments
        var newData = {
            name: 'To Habitica',
            url: gConfig.habiticaGuildUrl + guildId
        }  
        var item = {guildId: guildId, urlToAttach: gConfig.habiticaGuildToolUrl + guildId + gConfig.habiticaGuildToolPathAll}
        call.push({targetType: 'log', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postAttachmentUrl_Success, fnFailure: postAttachmentUrl_Failure, item: item})

        makeAxiosCall(_.cloneDeep(call))

        ajaxRunningCount--
        if (ajaxRunningCount == 0) postCreateAllMissingCardsComp()
    } 
        
    function postCreateCard_Failure(response, item, urlTo){
        consoleLogToFile('postCreateCard ******** ERROR for ' + item.guildId)
        
        ajaxRunningCount--
        if (ajaxRunningCount == 0) postCreateAllMissingCardsComp() // keep going as likely be already created
    } //postCreateCard

    function postAttachmentUrl_Success(data, item){
        if (gConfig.debug) consoleLogToFile('debug postAttachmentUrl SUCCESS for ' + item.cardId)

        // No further action needed
    }
        
    function postAttachmentUrl_Failure(response, item, urlTo){
            consoleLogToFile('postAttachmentUrl ******** ERROR for ' + item.guildId + ' (' + item.urlToAttach + ')')
    } //postDeleteCard
    
    

    function postCreateAllMissingCardsComp(){
        if (gConfig.debug) consoleLogToFile('debug postCreateAllMissingCardsComp START');
        if (actionTakenInLoop){
            //Loop again in case we need add a comment to a card 
            fetchBaseData()
        } else {
            postCommentCoveAll()
        }
        if (gConfig.debug) consoleLogToFile('debug postCreateAllMissingCardsComp END');  
    }

    if (gConfig.debug) consoleLogToFile('debug postCreateAllMissingCards END');
}

//////////////////////////////////////////////////////////////////////
////   Post Latest Cove Chat (Comment)               /////////////////
//////////////////////////////////////////////////////////////////////
function postCommentCoveAll(){
    if (gConfig.debug) consoleLogToFile('debug postCommentCoveAll START');
    //Go through each of the comments and post to guild as required.
    var retryAttempt_commentCove = 0
    ajaxRunningCount = guildCove.chat.length

    var i = guildCove.chat.length - 1
    var pastLastCoveMessage = false
    var cardId = ''
    var guildId = ''
    var textToPost = ''
    var readValue = ''
    var messageIdCove = ''
    var messageIdCove2 = '' //in case the last message was deleted.
    
    var call = []

    cardConfig.forEach(function(obj, index){
	    //Just get the first obj.value             
	    if (obj.idCustomField == logCustomFields['hailedId'].id){
            readValue = Object.values(obj.value)
            messageIdCove = readValue[0]    
        }

        if (obj.idCustomField == logCustomFields['leaderId'].id){
            readValue = Object.values(obj.value)
            messageIdCove2 = readValue[0]    
        }
    }); 

    if (guildCove.chat[0].id != messageIdCove ){
        while (i >= 0){ 
            //If messagesIdCove has passed just stop the code
            if ((pastLastCoveMessage == true) || (guildCove.chat[i].id == messageIdCove ) || (guildCove.chat[i].id == messageIdCove2 )){
                if (guildCove.chat[i+1].id != messageIdCove ) pastLastCoveMessage = true //testing if next message is last message or it was deleted.
                if ((guildCove.chat[i].text.search(gConfig.habiticaGuildUrl) >= 0) && (guildCove.chat[i].uuid != gConfig.botId) && (guildCove.chat[i].id != messageIdCove )){
                //Don't process the last message twice
                        
                    guildId = guildCove.chat[i].text.substring(guildCove.chat[i].text.search(gConfig.habiticaGuildUrl) + gConfig.habiticaGuildUrl.length, guildCove.chat[i].text.search(gConfig.habiticaGuildUrl) + gConfig.habiticaGuildUrl.length + 36)

                    textToPost = ''
                    textToPost += gConfigText.msgLogCoveComment +  '*' + guildCove.chat[i].username + ' (User Id: ' + guildCove.chat[i].uuid + ') on ' + Date(guildCove.chat[i].timestamp) + '*\n\n'
                    textToPost += guildCove.chat[i].text
                                            
                    if (gConfig.debug) consoleLogToFile('debug postCommentCoveAll GuildId: ' + guildId);
                    if (gConfig.debug) consoleLogToFile('debug postCommentCoveAll textToPost: ' + textToPost);

                    //slow but will do
                    cardId = ''
                    cards.forEach(function(obj, index){
                        if (obj.name ==  guildId){
                            cardId = obj.id 

                            obj.labels.forEach( function(obj2,index2){
                                if (obj2.id == logLabelAdmiralReport) guildsHasAdmiralReportLabel.push(guildId)  
                            });
                        }
                    }) 
                    if (cardId != ''){
                        if (gConfig.debug) consoleLogToFile('debug postCommentCove START for ' + guildId);
                        var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cardId  + gConfig.logServerPathComment
                        var newData = {
                            text: textToPost
                        } 
                        if (guildsHasAdmiralReportLabel.indexOf(guildId) < 0 ){
                            var item = {guildId: guildId, count: 0}
                        } else {
                            var item = {guildId: guildId, count: 1}
                        }
                        call.push({targetType: 'log', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postCommentCove_Success, fnFailure: postCommentCove_Failure, item: item})
                        if (guildsHasAdmiralReportLabel.indexOf(guildId) < 0 ){
                            guildsHasAdmiralReportLabel.push(item.guildId)  //Add guild now in case there is another label later.

                            var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cardId + '/idLabels'
                            var newData = {value: logLabelAdmiralReport}  
                            var item = {guildId: guildId, count: 1}
                            call.push({targetType: 'log', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postCommentCove_Success, fnFailure: postCommentCove_Failure, item: item})              
                        }

                    } else {
                        if (gConfig.debug) consoleLogToFile('debug postCommentCove NO WORK AS Private Guild for ' + guildId)
                        ajaxRunningCount--
                        if (ajaxRunningCount == 0) postCommentCoveAllComp() 
                    }
                } else {
                    ajaxRunningCount--
                    if (ajaxRunningCount == 0) postCommentCoveAllComp() 
                }
            } else {
                ajaxRunningCount--
                if (ajaxRunningCount == 0) postCommentCoveAllComp() 
            }
            i--
        }
        if (call.length > 0) makeAxiosCall(_.cloneDeep(call)) 
    } else {
        //just skip this bit - No comments to update
        fetchAndUpdateAllData()
    } 


    function postCommentCove_Success(data, item){   
        if (gConfig.debug) consoleLogToFile('debug postCommentCove SUCCESS for ' + item.guildId + ' - Count: ' + item.count )

        if (item.count > 0){      
            if (guildsHasAdmiralReportLabel.indexOf(guildId) < 0 ) guildsHasAdmiralReportLabel.push(item.guildId)  
            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCommentCoveAllComp() 
        }        
    }  
        
    function postCommentCove_Failure(response, item, urlTo){
            consoleLogToFile('postCommentCove ******** ERROR for ' + item.guildId + ' (' + urlTo + ')')
 
            //Continue on assume it ok
            pastLastCoveMessage = false
            postCommentCoveAllComp()
    } //postDeleteCard

    function postCommentCoveAllComp(){
        if (gConfig.debug) consoleLogToFile('debug postCommentCoveAllComp START');

        if (pastLastCoveMessage == true){
            if (guildCove.chat[0].id != messageIdCove ){
                if (gConfig.debug) consoleLogToFile('debug postLatestData_coveHailedId START for ' + guildId);

                var call = []
                var newValue = {}
                
                newValue[logCustomFields['hailedId'].type] = guildCove.chat[0].id
                var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + logCardConfig + gConfig.logServerPathCustField + '/' + logCustomFields['hailedId'].id + gConfig.logServerPathCustFieldItem
                var newData = {
                    value: newValue
                }  
                var item = {hailCount: 0}
                call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postLatestData_coveHailedId_Success, fnFailure: postLatestData_coveHailedId_Failure, item: item})                 
                
                var newValue = {}
                newValue[logCustomFields['leaderId'].type] = guildCove.chat[1].id
                urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + logCardConfig + gConfig.logServerPathCustField + '/' + logCustomFields['leaderId'].id + gConfig.logServerPathCustFieldItem
                var newData = {
                    value: newValue
                }  
                var item = {hailCount: 1}
                call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postLatestData_coveHailedId_Success, fnFailure: postLatestData_coveHailedId_Failure, item: item})   
                
                makeAxiosCall(_.cloneDeep(call))   
            
            } else {
                fetchAndUpdateAllData()  
            }
        } else {
            //If not past then stop code
            if (gConfig.debugConsole) console.log('UNABLE TO PROCESS COVE COMMENTS CHECK LATEST MESSAGE ID')
            if (gConfig.debugConsole) console.log('GUILDS NOT CHECKED')
            consoleLogToFile('UNABLE TO PROCESS COVE COMMENTS CHECK LATEST MESSAGE ID')
            consoleLogToFile('GUILDS NOT CHECKED')
        }
        if (gConfig.debug) consoleLogToFile('debug postCommentCoveAllComp END');
    }   

    function postLatestData_coveHailedId_Success(data, item){
		if (gConfig.debug) consoleLogToFile('debug postLatestData_coveHailedId SUCCESS for ' + item.hailCount)
			
		if (item.hailCount == 1) fetchBaseData() //Refretch as labels have change.	

    }

    function postLatestData_coveHailedId_Failure(response, item, urlTo){
        consoleLogToFile('postLatestData_coveHailedId ******** ERROR for ' + item.guildId + ' (' + urlTo + ')')

        if (gConfig.debugConsole) console.log('UNABLE TO UPDATE LATEST MESSAGE ID')
        if (gConfig.debugConsole) console.log('GUILDS NOT CHECKED')
        consoleLogToFile('UNABLE TO UPDATE LATEST MESSAGE ID')
        consoleLogToFile('GUILDS NOT CHECKED')
    } //postLatestData_coveHailedId
		 

} //postCommentCoveAll

//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////
////   2nd Part:                                        /////////////////
////   For each Card get data and update Custom Fields  /////////////////
//////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////
function fetchAndUpdateAllData(){
    if (gConfig.debug) consoleLogToFile('debug fetchAndUpdateAllData START');
    if (gConfig.debugConsole) console.log('2nd Part: For each Card get data and update Custom Fields'); 

    var dropAnchor = false
    var admiralReport = false // If has Admiral Report then refresh data
    var removeActiveComment = false
    var missingLanguage = false
    var testMissingLanguage = false
    var labelLangCount = 0
    var labelCategoryCount = 0

    var ajaxRunningCount_guildsToTest = []


    //Just create the cards with todays due date. The data will be updated later.
    if ((testOnlyThisGuild!='') &&  (cards_justId.indexOf(testOnlyThisGuild) < 0)){
        if (retryAttempt < 4) {
            fetchBaseData() // get the data again as the card just been created
        } else {
            consoleLogToFile('***********************************************************')
            consoleLogToFile('***********************************************************')
            consoleLogToFile('        UNABLE TO COMPLETE. UNABLE TO FIND GUILD')
            consoleLogToFile('***********************************************************')
            consoleLogToFile('***********************************************************')
            consoleLogToFile('***********************************************************')
            consoleLogToFile('***********************************************************')

            console.log('***********************************************************')
            console.log('***********************************************************')
            console.log('        UNABLE TO COMPLETE. UNABLE TO FIND GUILD')
            console.log('***********************************************************')
            console.log('***********************************************************')
        }
    } else {
           

        cards.forEach(function(obj, index){
            dropAnchor = false
            admiralReport = false
            removeActiveComment = false
            missingLanguage = false
            testMissingLanguage = false
            labelLangCount = 0
            labelCategoryCount = 0
            labelCategory = []
           

            //check if mising language & other label actions
            obj.labels.forEach(function (obj2, index2){
                if (obj2.id == logLabelAllLanguages) testMissingLanguage = true
                if (obj2.color == gConfig.labelColour_Language) labelLangCount++
                if (obj2.id == logLabelDropAnchor) dropAnchor = true
                if (obj2.id == logLabelAdmiralReport) guildsHasAdmiralReportLabel.push(obj.name)
                if (obj2.id == logLabelRemoveActiveComment) removeActiveComment = true
                if (obj2.color == gConfig.labelColour_Category){
                    labelCategoryCount++
                    labelCategory.push(obj2.name)
                }
            });

            if ((testMissingLanguage) && (labels_allLanguages.length != labelLangCount)) missingLanguage = true
            
            //add to missingCategories or too many categories. These will be reported at the end.
            if ((labelCategoryCount == 0) && (obj.idList == logListIdClearSailing) && (reportWarningNoRoster.indexOf(obj.name) < 0)) reportWarningNoRoster.push(obj.name) // Don't care if currently under pirate action (or private)
            if ((labelCategoryCount > 1) && (reportWarningOverRoster.indexOf(obj.name) <0)){
                reportWarningOverRoster.push(obj.name)
                reportWarningOverRoster_Label[obj.name] = labelCategory
            }

            //Notes on Tests
            if (gConfig.debugVerbose) consoleLogToFile('Update Card? ' + obj.name)
            if (gConfig.debugVerbose) consoleLogToFile('Due Date: ' + obj.due)
            if (gConfig.debugVerbose) consoleLogToFile('Date to compare: ' + moment().utc().add(0, 'days').format('YYYY-MM-DDTHH:mm:ss.SSS'))
            if (gConfig.debugVerbose) consoleLogToFile('Is it Due?: '+ (moment().utc().add(0, 'days').isAfter(obj.due)))
            
            if (gConfig.debugVerbose) consoleLogToFile('Bot Leader?: ' + (
                            (guildsBotLeader.indexOf(obj.name) >=0) && 
                            (
                                (obj.idList == logListIdClearSailing) ||  (obj.idList == logListIdJustLaunched) || 
                                (obj.idList == logListIdPrivateNavy) 
                            ) 
            ))
            if (gConfig.debugVerbose) consoleLogToFile('Force Update (Dont match masterList?): ' + (guildsForceUpdate.indexOf(obj.name) >=0)) 
            if (gConfig.debugVerbose) consoleLogToFile('No due date?: ' + (
                            (obj.due == undefined) &&
                            (guilds_justId.indexOf(obj.name) >= 0)
                        ))
            if (gConfig.debugVerbose) consoleLogToFile('Sunk? : ' + (
                            (guilds_justId.indexOf(obj.name) < 0) &&
                            (
                                (obj.idList == logListIdJustLaunched) ||
                                (obj.idList == logListIdClearSailing) ||
                                (obj.idList == logListIdTargetSpotted) ||
                                (obj.idList == logListIdCaptainMIA) ||
                                (obj.idList == logListIdCaptured) ||
                                (obj.idList == logListIdLastRites) ||
                                (obj.idList == logListIdDoNotHail) ||
                                (obj.idList == logListIdPrivateNavy) ||
                                (obj.idList == logListIdBermudaTriangle)
                            )
            ))
            if (gConfig.debugVerbose) consoleLogToFile('No Guild Info? : ' + (guilds_justId.indexOf(obj.name) < 0))
            if (gConfig.debugVerbose) consoleLogToFile('List id: ' + obj.idList)
            if (gConfig.debugVerbose) consoleLogToFile('Missing Lang: ' + missingLanguage)
            if (gConfig.debugVerbose) consoleLogToFile('Drop Anchor: ' + dropAnchor)
            if (gConfig.debugVerbose) consoleLogToFile('Admiral Report: ' + (
                            (guildsHasAdmiralReportLabel.indexOf(obj.name) >= 0) && 
                            ((obj.idList == logListIdClearSailing) || (obj.idList == logListIdPrivateNavy) || (obj.idList == logListIdBermudaTriangle)) && 
                            (moment.utc().format('E') == gConfig.weekdayReport)
            )) //only if in Clear Sailing or Private Navy Otherwise it will be picked up and it is a weekday for the report
            if (gConfig.debugVerbose) consoleLogToFile('Remove Active Comment: ' + removeActiveComment)
            

            //Only refresh data if 
            // not Specifically asked:
                // due date is due or 
                // leader has change to the BotLeader and in the logListIdClearSailing or logListIdJustLaunched 
                // or Sunk Guild (no due Date) and there is a guild
                // or guild has been sunk and not in sunk list
                // missing languages
                // drop anchor (sliently monitoring guild)
            // or force refresh for specified guild       
            if (
                ((
                    (
                        (moment().utc().add(0, 'days').isAfter(obj.due)) || 
                        (
                            (guildsBotLeader.indexOf(obj.name) >=0) && 
                            (
                                (obj.idList == logListIdClearSailing) ||  (obj.idList == logListIdJustLaunched) || 
                                (obj.idList == logListIdPrivateNavy) 
                            ) 
                        ) || 
                        (guildsForceUpdate.indexOf(obj.name) >=0) ||
                        (
                            (obj.due == undefined) &&
                            (guilds_justId.indexOf(obj.name) >= 0)
                        ) ||
                        (
                            (guilds_justId.indexOf(obj.name) < 0) &&
                            (
                                (obj.idList == logListIdJustLaunched) ||
                                (obj.idList == logListIdClearSailing) ||
                                (obj.idList == logListIdTargetSpotted) ||
                                (obj.idList == logListIdCaptainMIA) ||
                                (obj.idList == logListIdCaptured) ||
                                (obj.idList == logListIdLastRites) ||
                                (obj.idList == logListIdDoNotHail) ||
                                (obj.idList == logListIdPrivateNavy) ||
                                (obj.idList == logListIdBermudaTriangle)
                            )  //Specified so to ignore Instruction lists etc.
                        ) ||
                        (
                            (missingLanguage)
                        ) ||
                        (
                            (dropAnchor)
                        ) ||
                        (
                            (guildsHasAdmiralReportLabel.indexOf(obj.name) >= 0) && 
                            ((obj.idList == logListIdClearSailing) || (obj.idList == logListIdPrivateNavy) || (obj.idList == logListIdBermudaTriangle)) && 
                            (moment.utc().format('E') == gConfig.weekdayReport)
                        ) ||
                        (
                            (removeActiveComment)
                        ) 
                    ) && (testOnlyThisGuild == '')
                )) || 
                (testOnlyThisGuild == obj.name) 
            ){
                
                if (
                        (guilds_justId.indexOf(obj.name) < 0) &&
                        (obj.idList != logListIdSunk)
                ){
                    //Guild Sunk Can't update any info                
                    guildsLatestData[obj.name] = {}
                    guildsLatestData[obj.name].cFieldsStatus = 4
                } else if (guildsLatestData[obj.name] == undefined){    					
                    guildsLatestData[obj.name] = {}
                    guildsLatestData[obj.name].cFieldsStatus = 0
                }

                if (ajaxRunningCount_guildsToTest.length < gConfig.testchunk){
                    if (gConfig.debug) consoleLogToFile('Inspect this Ship ' + obj.name)
                    totalGuilds.tested['total']++
                    totalGuilds.tested['attempt' + totalGuilds.tested.fullAttempt ]++
                    ajaxRunningCount_guildsToTest.push({guildId: obj.name, cardIndex: index})   
                } else {
					actionTakenInLoop = true //Unable to test everything
                    if (gConfig.debug) consoleLogToFile('Dock full for ship of status ' + guildsLatestData[obj.name].cFieldsStatus + ': ' + obj.name + ' : Action Taken. Set to Loop again') 
                } 
            } 
        });

         
        if (ajaxRunningCount_guildsToTest.length > 0){
            fetchLatestGuild() //first step        
        } else {
            postCompleteUpdate_Comp()
        }
    } 

    //////////////////////////////////////////////////////////////////////
    ////   Fetch Latest Guild Data - cFieldsStatus0      /////////////////
    ////   cFieldsStatus0
    //////////////////////////////////////////////////////////////////////
    function fetchLatestGuild(){
        if (gConfig.debug) consoleLogToFile('debug fetchLatestGuild START')

        var ajaxRunningCount = 0
        var call = []
        
        ajaxRunningCount_guildsToTest.forEach(function (obj, index){   
            if (guildsLatestData[obj.guildId].cFieldsStatus == 0){
                actionTakenInLoop = true   
                if (gConfig.debug) consoleLogToFile('fetchLatestGuild(' + obj.guildId + ': Action Taken. Set to Loop again')	
                ajaxRunningCount++
                var urlToAction = gConfig.botServerUrl + gConfig.botServerPathGroup + '/' + obj.guildId
                var newData = {}
                var item = obj
                call.push({targetType: 'bot', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: fetchLatestGuild_Success, fnFailure: fetchLatestGuild_Failure, item: item})
            } 
        });
        if (call.length > 0){
            makeAxiosCall(_.cloneDeep(call))
        } else {
            fetchLeader()
        }
        
        function fetchLatestGuild_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug fetchLatestGuild_Success Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
            
            var guildId = item.guildId
            var cardIndex = item.cardIndex

            var tempBox = data
            if (tempBox == undefined){
                //Habitica hasn't supplied the data
                //Guild recently sunk?
                if (gConfig.debug) consoleLogToFile('debug No data found for ' + item.guildId  + '. Maybe Sunk? Skipping Guild to pick on next retry.')
            
            } else {
                if (guildsLatestData[guildId].hailStatus == undefined){
                    guildsLatestData[guildId] = {guild: tempBox, leader: {}, cFields: {}, cFieldsStatus: 1, hailStatus: 0, hailData: {}, process: 0, habiticaOfficial: false, labels: cards[cardIndex].labels}
                }

                //set up default custom fields
                logCustomFields_justId.forEach(function (obj, index){
                    guildsLatestData[guildId].cFields[logCustomFields[obj].id] = logCustomFields[obj].defaultValue
                })

                //check if official guild (dont trust the label)
                if (tempBox.categories != undefined){
                    tempBox.categories.forEach( function (obj, index){
                        if (obj.slug == gConfig.habiticaCategoryOfficial) guildsLatestData[guildId].habiticaOfficial = true
                    })
                } else {
                    if (gConfig.debug) consoleLogToFile('******** ERROR: Cant see categories for ' + guildId)
                    if (gConfig.debug) console.log('******** ERROR: Cant see categories for ' + guildId)
                }

                //Ready to go onto next step
                guildsLatestData[guildId].cFieldsStatus = 1
            }

            ajaxRunningCount--
            if (ajaxRunningCount == 0) fetchLeader()         
        } 
        
        function fetchLatestGuild_Failure(response, item, urlTo){
            consoleLogToFile('fetchLatestGuild ******** ERROR for : ' + item.guildId)

            ajaxRunningCount-- //no need to go further jump to the end for this one.
            if (ajaxRunningCount == 0) fetchLeader()
        }
        //if (gConfig.debug) consoleLogToFile('debug fetchLatestGuild END for ' + guildId);
    } //fetchLatestGuild


    //////////////////////////////////////////////////////////////////////
    ////   Fetch Latest Leader  Data -  cFieldsStatus1   /////////////////
    //////////////////////////////////////////////////////////////////////
    function fetchLeader(){
        if (gConfig.debug) consoleLogToFile('debug fetchLeader START');
        if (gConfig.debugConsole) console.log('Fetch Guilds from Habitica Completed. Now starting Leaders'); 
        
        var ajaxRunningCount = 0
        var call = []

        ajaxRunningCount_guildsToTest.forEach(function (obj, index){
            var guildId = obj.guildId
            var cardIndex = obj.cardIndex

            if (guildsLatestData[guildId].cFieldsStatus == 1){
                actionTakenInLoop = true //in case this failed in the previous loop
                if (gConfig.debug) consoleLogToFile('fetchLeader (' + guildId + '): Action Taken. Set to Loop again')
                if (guildsBotLeader.indexOf(guildId) < 0){
                    ajaxRunningCount++
                    var urlToAction = gConfig.botServerUrl + gConfig.botServerPathMemberProfilePart + '/' + guildsLatestData[guildId].guild.leader.id
                    var newData = {}
                    var item = obj
                    call.push({targetType: 'bot', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: fetchLeader_Success, fnFailure: fetchLeader_Failure, item: item})

                } else {
                    if (gConfig.debug) consoleLogToFile('debug fetchLeader(' + guildId + '): Add guild Bot details')

                    guildsLatestData[guildId].leader = user
                    guildsLatestData[guildId].leader.nameForLog = user.auth.local.username

                    guildsLatestData[guildId].cFieldsStatus = 2
                } 
            } 
        });  
        if (call.length > 0){
            makeAxiosCall(_.cloneDeep(call))  
        } else {
            fetchCardCustomFieldsAndComments()
        }

        function fetchLeader_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug fetchLeader Count:' + ajaxRunningCount + '  SUCCESS for ' + item.guildId)
            var guildId = item.guildId

            guildsLatestData[guildId].leader = data

            //handle missing Usernames
            if (guildsLatestData[guildId].leader.auth != undefined && guildsLatestData[guildId].leader.auth.local != undefined && guildsLatestData[guildId].leader.auth.local.username != undefined){
                guildsLatestData[guildId].leader.nameForLog = guildsLatestData[guildId].leader.auth.local.username
            } else {
                guildsLatestData[guildId].leader.nameForLog = gConfigText.msgUserNameNotSet + guildsLatestData[guildId].leader.profile.name
            }

            guildsLatestData[guildId].cFieldsStatus = 2
            ajaxRunningCount--
            if (ajaxRunningCount == 0) fetchCardCustomFieldsAndComments()
        }
        
        function fetchLeader_Failure(response, item, urlTo){
            consoleLogToFile('fetchLeader ******** ERROR for : ' + item.guildId)

            ajaxRunningCount-- //no need to go further jump to the end for this one.
            if (ajaxRunningCount == 0) fetchCardCustomFieldsAndComments()
        } 
        //if (gConfig.debug) consoleLogToFile('debug fetchLeader END ); 
    } //fetchLeader

    //////////////////////////////////////////////////////////////////////
    ////   Fetch Custom Fields & Latest Comment - cFieldsStatus2      ////
    //////////////////////////////////////////////////////////////////////
    function fetchCardCustomFieldsAndComments(){
        if (gConfig.debug) consoleLogToFile('debug fetchCardCustomFieldsAndComments START');
        if (gConfig.debugConsole) console.log('Now fetching & testing Custom Fields'); 
        
        var ajaxRunningCount = 0 
        var call = []
      
        ajaxRunningCount_guildsToTest.forEach(function (obj, index){
            var guildId = obj.guildId
            var cardIndex = obj.cardIndex
            if (guildsLatestData[guildId].cFieldsStatus == 2){
                actionTakenInLoop = true
                if (gConfig.debug) consoleLogToFile('fetchCardCustomFieldsAndComments(' + guildId + '): Action Taken. Set to Loop again')			
                
                //////// fetchLastComment 
                if ((testOnlyThisGuild == '')  && (moment.utc().format('E') == gConfig.weekdayReport) &&  (guildsHasAdmiralReportLabel.indexOf(guildId) >= 0)){
                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathAction
                    var newData = {filter: 'commentCard', limit: 1000}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: fetchLastComment_Success, fnFailure: fetchLastComment_Failure, item: item}) 
                }
                ajaxRunningCount++
                var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathAllCustField
                var newData = {} 
                var item = obj
                call.push({targetType: 'log', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: fetchCardCustomFields_Success, fnFailure: fetchCardCustomFields_Failure, item: item})
            } 
        });
        if (call.length > 0){
            makeAxiosCall(_.cloneDeep(call)) 
        } else {
            postCardCustomFields()
        }

        function fetchLastComment_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug fetchLastComment Count:' + ajaxRunningCount + '  SUCCESS for ' + item.guildId)
            var guildId = item.guildId
            var tempBox = data
            
            guildsLatestData[guildId].latestComment = ''
            tempBox.forEach(function(obj, index){
                if (guildsLatestData[guildId].latestComment == ''){
                    if (obj.data != undefined){
                        if (obj.data.text != undefined){
                            if (obj.data.text.substring(0,gConfigText.msgLogCoveComment.length) == gConfigText.msgLogCoveComment) guildsLatestData[guildId].latestComment = obj.data.text
                        }
                    }
                }
            });
            if (guildsLatestData[guildId].latestComment == ''){
                guildsLatestData[guildId].latestComment = gConfigText.msgLogMissingComment
                consoleLogToFile('******** ERROR Labeled as Admiral Comment but no comment found for: ' + guildId)
            }
            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields()
        }

        function fetchLastComment_Failure(response, item, urlTo){
            consoleLogToFile('fetchLastComment_Failure ******** ERROR for ' + item.guildId)
            
            //Wont stop the process for this. Just look wrong on the report
            guildsLatestData[guildId].latestComment = gConfigText.msgLogMissingComment
            consoleLogToFile('******** ERROR Getting Admiral Comment for: ' + guildId)

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields()
        }

        function fetchCardCustomFields_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug fetchCardCustomFields  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
            
            var tempBox = data
            
            tempBox.forEach(function(obj, index){
                //Just get the first obj.value                         
                var readValue = Object.values(obj.value)
                var readKeys = Object.keys(obj.value)
                
                if (readKeys[0] == 'checked'){
                    if ((readValue[0] = 'true') || (readValue[0] === true)){
                        guildsLatestData[item.guildId].cFields[obj.idCustomField] = true
                    } else {
                        guildsLatestData[item.guildId].cFields[obj.idCustomField] = false
                    }

                } else {
                    guildsLatestData[item.guildId].cFields[obj.idCustomField] = readValue[0]
                }

            });

            consoleLogToFile(guildsLatestData[item.guildId].cFields[logCustomFields['guildCreated'].id])
            if ((guildsLatestData[item.guildId].cFields[logCustomFields['guildCreated'].id] == undefined) || (guildsLatestData[item.guildId].cFields[logCustomFields['guildCreated'].id] == '')) guildsLatestData[item.guildId].cFields[logCustomFields['guildCreated'].id] == gConfig.masterDateNew

            //This is just in case so the next does not error and stop the code. Should be done before
            if (masterList[item.guildId] == undefined) masterList[item.guildId] = {}

            masterList[item.guildId].leader = guildsLatestData[item.guildId].cFields[logCustomFields['leaderId'].id] 
            masterList[item.guildId].name = guildsLatestData[item.guildId].cFields[logCustomFields['guildName'].id] 
             
            masterList[item.guildId].summary = guildsLatestData[item.guildId].guild.summary 
            masterList[item.guildId].privacy = guildsLatestData[item.guildId].guild.privacy // formated correctly
            masterList[item.guildId].created = guildsLatestData[item.guildId].cFields[logCustomFields['guildCreated'].id]
            
            guildsLatestData[item.guildId].cFieldsStatus = 3             
            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields()
        }
                
        function fetchCardCustomFields_Failure(response, item, urlTo){
            consoleLogToFile('fetchCardCustomFields ******** ERROR for ' + item.guildId)

            ajaxRunningCount-- //no need to go further jump to the end for this one.
            if (ajaxRunningCount == 0) postCardCustomFields()
        } 

        //if (gConfig.debug) consoleLogToFile('debug fetchCardCustomFields END for ' + guildId);
    } //fetchCardCustomFields

    //////////////////////////////////////////////////////////////////////
    ////   Fetch Custom Field to compare for update - cFieldsStatus3 /////
    //////////////////////////////////////////////////////////////////////
    function postCardCustomFields(){
        if (gConfig.debug) consoleLogToFile('debug postCardCustomFields START'); 
        
        var ajaxRunningCount = 0 // Number of Calls to make
        var ajaxRunningCount_guildName = 0
        var ajaxRunningCount_leaderId = 0
        var ajaxRunningCount_failed = [] //guilds that failed one or more times
        var call = []
        var callLast = [] //This will have the last call to update the update date. This should be done after all other calls.
        var call_guildName = []
        var call_leaderId = []

        ajaxRunningCount_guildsToTest.forEach(function (obj, index){
            var guildId = obj.guildId
            var cardIndex = obj.cardIndex

            if (guildsLatestData[guildId].cFieldsStatus == 3){

                //////////////////////////////////////////////////////////////////////
                ////   guildName 
                //////////////////////////////////////////////////////////////////////
                if (guildsLatestData[guildId].cFields[logCustomFields['guildName'].id].trim() != guildsLatestData[guildId].guild.name.trim()){
                    actionTakenInLoop = true
                    if (gConfig.debug) consoleLogToFile('guildName(' + guildId + '): Action Taken. Set to Loop again')			
                     
                    var textToPost = 'Guild name has changed to: ' + guildsLatestData[guildId].guild.name 
                    if (
                        (guildsLatestData[guildId].cFields[logCustomFields['guildName'].id] != '') &&
                        (guildsLatestData[guildId].cFields[logCustomFields['guildName'].id] != logCustomFields['guildName'].defaultValue) 
                    )  textToPost += '\nFrom: ' + guildsLatestData[guildId].cFields[logCustomFields['guildName'].id] 

                    ajaxRunningCount++ 
                    ajaxRunningCount_guildName++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathComment
                    var newData = {text: textToPost}
                    var item = {guildId: guildId, cardIndex: cardIndex, guildName: true}
                    call.push({targetType: 'log', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_guildNamePart1_Success, fnFailure: postCardCustomFields_Failure, item: item})                    
                }

                //////////////////////////////////////////////////////////////////////
                ////   guildCreated
                //////////////////////////////////////////////////////////////////////
                if (moment(guildsLatestData[guildId].cFields[logCustomFields['guildCreated'].id]).isBefore(gConfig.masterDateRoundUp)){
                    actionTakenInLoop = true   
			        if (gConfig.debug) consoleLogToFile('guildCreated: Action Taken. Set to Loop again')			
                    
                    var newValue = {}
                    //To fix data where guilds were loaded over 2 days. (Uniform start date)
                    if (guildsLatestData[guildId].cFields[logCustomFields['guildCreated'].id] != gConfig.masterDateNew){
                        newValue[logCustomFields['guildCreated'].type] = gConfig.masterDateRoundUp
                    } else {
                        newValue[logCustomFields['guildCreated'].type] = moment().utc().format('YYYY-MM-DD')
                    }

                    ajaxRunningCount++ 
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['guildCreated'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue} 
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_guildCreated_Success, fnFailure: postCardCustomFields_Failure, item: item}) 
                }

                //////////////////////////////////////////////////////////////////////
                ////   memberCount
                //////////////////////////////////////////////////////////////////////
                if (guildsLatestData[guildId].cFields[logCustomFields['memberCount'].id] != guildsLatestData[guildId].guild.memberCount){
                    actionTakenInLoop = true   
                    if (gConfig.debug) consoleLogToFile('memberCount(' + guildId + '): Action Taken. Set to Loop again')			

                    var newValue = {}
                    newValue[logCustomFields['memberCount'].type] = String(guildsLatestData[guildId].guild.memberCount)

                    ajaxRunningCount++ 
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['memberCount'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_memberCount_Success, fnFailure: postCardCustomFields_Failure, item: item}) 
                }

                //////////////////////////////////////////////////////////////////////
                ////   leaderId
                //////////////////////////////////////////////////////////////////////
                if (guildsLatestData[guildId].cFields[logCustomFields['leaderId'].id] != guildsLatestData[guildId].leader.id){
                    actionTakenInLoop = true
                    if (gConfig.debug) consoleLogToFile('leaderId(' + guildId + '): Action Taken. Set to Loop again')

                    var textToPost = 'Leader has changed to: ' + guildsLatestData[guildId].leader.nameForLog + ' (UserId: ' + guildsLatestData[guildId].leader.id + ')'
            
                    if (guildsLatestData[guildId].cFields[logCustomFields['leaderId'].id] != '')  textToPost += '\nFrom: ' + guildsLatestData[guildId].cFields[logCustomFields['leaderName'].id] + ' (UserId: ' + guildsLatestData[guildId].cFields[logCustomFields['leaderId'].id] + ')'

                    ajaxRunningCount++ 
                    ajaxRunningCount_leaderId++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathComment
                    var newData = {text: textToPost}
                    var item = {guildId: guildId, cardIndex: cardIndex, leaderId: true}
                    call.push({targetType: 'log', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_leaderIdPart1_Success, fnFailure: postCardCustomFields_Failure, item: item}) 
                }

                //////////////////////////////////////////////////////////////////////
                ////   leaderName
                //////////////////////////////////////////////////////////////////////
                if (guildsLatestData[guildId].cFields[logCustomFields['leaderName'].id].trim() != guildsLatestData[guildId].leader.nameForLog.trim() ){
                    actionTakenInLoop = true
			        if (gConfig.debug) consoleLogToFile('leaderName: Action Taken. Set to Loop again')

                    var newValue = {}
                    newValue[logCustomFields['leaderName'].type] = guildsLatestData[guildId].leader.nameForLog 

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['leaderName'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_leaderName_Success, fnFailure: postCardCustomFields_Failure, item: item}) 
                }

                //////////////////////////////////////////////////////////////////////
                ////   leaderBorn
                ////////////////////////////////////////////////////////////////////// 
                if (moment(guildsLatestData[guildId].cFields[logCustomFields['leaderBorn'].id]).isSame(moment(guildsLatestData[guildId].leader.auth.timestamps.created)) != true){
                    actionTakenInLoop = true
			        if (gConfig.debug) consoleLogToFile('leaderBorn(' + guildId + '): Action Taken. Set to Loop again')

                    var newValue = {}
                    newValue[logCustomFields['leaderBorn'].type] = String(moment(guildsLatestData[guildId].leader.auth.timestamps.created).utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['leaderBorn'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_leaderBorn_Success, fnFailure: postCardCustomFields_Failure, item: item}) 
                }  

                //////////////////////////////////////////////////////////////////////
                ////   leaderLastLogin
                //////////////////////////////////////////////////////////////////////
                //This is compared to the hour to avoid GuildBot constantly updating. 
                if (moment(guildsLatestData[guildId].cFields[logCustomFields['leaderLastLogin'].id]).utc().format('YYYY-MM-DDTHH') != moment(guildsLatestData[guildId].leader.auth.timestamps.loggedin).utc().format('YYYY-MM-DDTHH')){
                    actionTakenInLoop = true
			        if (gConfig.debug) consoleLogToFile('leaderLastLogin: Action Taken. Set to Loop again')

                    var newValue = {}
                    newValue[logCustomFields['leaderLastLogin'].type] = String(moment(guildsLatestData[guildId].leader.auth.timestamps.loggedin).utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['leaderLastLogin'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_leaderLastLogin_Success, fnFailure: postCardCustomFields_Failure, item: item}) 
                }

                //////////////////////////////////////////////////////////////////////
                ////   chatLines
                //////////////////////////////////////////////////////////////////////
                if (guildsLatestData[guildId].cFields[logCustomFields['chatLines'].id] != guildsLatestData[guildId].guild.chat.length){
                    actionTakenInLoop = true
			        if (gConfig.debug) consoleLogToFile('chatLines(' + guildId + '): Action Taken. Set to Loop again')

                    var newValue = {}
                    newValue[logCustomFields['chatLines'].type] = String(guildsLatestData[guildId].guild.chat.length)

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['chatLines'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_chatLines_Success, fnFailure: postCardCustomFields_Failure, item: item}) 
                }

                //////////////////////////////////////////////////////////////////////
                ////   chatLast
                //////////////////////////////////////////////////////////////////////
                var testResult = false
                if (guildsLatestData[guildId].cFields[logCustomFields['chatLast'].id] == ''){
                    if (guildsLatestData[guildId].guild.chat[0] != undefined) testResult = true
                } else if (guildsLatestData[guildId].guild.chat[0] == undefined){
                    testResult = true
                } else {
                    if (moment(guildsLatestData[guildId].cFields[logCustomFields['chatLast'].id]).isSame(moment(guildsLatestData[guildId].guild.chat[0].timestamp).utc()) != true) testResult = true
                }
            
                if (testResult){
                    if (gConfig.debug) consoleLogToFile('chatLast(' + guildId + '): No Action Taken. As Chat Moves too Fast')

                    if (guildsLatestData[guildId].guild.chat[0] != undefined){
                        var newValue = {}
                        newValue[logCustomFields['chatLast'].type] = String(moment(guildsLatestData[guildId].guild.chat[0].timestamp).utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))
                    } else {
                        var newValue = ''
                    }

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['chatLast'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_chatLast_Success, fnFailure: postCardCustomFields_Failure, item: item}) 
                }

                //////////////////////////////////////////////////////////////////////
                ////   chatLast5
                //////////////////////////////////////////////////////////////////////
                var testResult = false
                if (guildsLatestData[guildId].cFields[logCustomFields['chatLast5'].id] == ''){
                    if (guildsLatestData[guildId].guild.chat[5] != undefined) testResult = true
                } else if (guildsLatestData[guildId].guild.chat[5] == undefined){
                    testResult = true
                } else {
                    if (moment(guildsLatestData[guildId].cFields[logCustomFields['chatLast5'].id]).isSame(moment(guildsLatestData[guildId].guild.chat[5].timestamp).utc()) != true) testResult = true
                }
            
                if (testResult){
                    if (gConfig.debug) consoleLogToFile('chatLast5(' + guildId + '): No Action Taken. As Chat Moves too Fast')

                    if (guildsLatestData[guildId].guild.chat[5] != undefined){
                        var newValue = {}
                        newValue[logCustomFields['chatLast5'].type] = String(moment(guildsLatestData[guildId].guild.chat[5].timestamp).utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))
                    } else {
                        var newValue = ''
                    }

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['chatLast5'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_chatLast5_Success, fnFailure: postCardCustomFields_Failure, item: item}) 
                }

                //////////////////////////////////////////////////////////////////////
                ////   chatLast20
                //////////////////////////////////////////////////////////////////////
                var testResult = false
                if (guildsLatestData[guildId].cFields[logCustomFields['chatLast20'].id] == ''){
                    if (guildsLatestData[guildId].guild.chat[20] != undefined) testResult = true
                } else if (guildsLatestData[guildId].guild.chat[20] == undefined){
                    testResult = true
                } else {
                    if (moment(guildsLatestData[guildId].cFields[logCustomFields['chatLast20'].id]).isSame(moment(guildsLatestData[guildId].guild.chat[20].timestamp).utc()) != true) testResult = true
                }
            
                if (testResult){
                    if (gConfig.debug) consoleLogToFile('chatLast20(' + guildId + '): No Action Taken. As Chat Moves too Fast')

                    if (guildsLatestData[guildId].guild.chat[20] != undefined){
                        var newValue = {}
                        newValue[logCustomFields['chatLast20'].type] = String(moment(guildsLatestData[guildId].guild.chat[20].timestamp).utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))
                    } else {
                        var newValue = ''
                    }

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['chatLast20'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_chatLast20_Success, fnFailure: postCardCustomFields_Failure, item: item}) 
                }

                //////////////////////////////////////////////////////////////////////
                ////   hailedChatLines
                //////////////////////////////////////////////////////////////////////
                var testResult = false
                if (guildsLatestData[guildId].cFields[logCustomFields['hailedId'].id] == ''){
                    if (guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id] != '') testResult = true
                } else {
                    // Calculate the number of lines
                    var newCount = 0
                    
                    while (
                        (guildsLatestData[guildId].guild.chat[newCount] != undefined) && 
                        (guildsLatestData[guildId].guild.chat[newCount].id != guildsLatestData[guildId].cFields[logCustomFields['hailedId'].id])
                    ){
                        newCount++
                    }
                    if (guildsLatestData[guildId].guild.chat[newCount] == undefined) newCount = -1
                    if (guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id] != newCount) testResult = true
                }
                
                if (testResult){
                    if (gConfig.debug) consoleLogToFile('hailedChatLines(' + guildId + '): No Action Taken. As Chat Moves too Fast')

                    var newValue = {}
                    if (guildsLatestData[guildId].cFields[logCustomFields['hailedId'].id] != ''){
                        newValue[logCustomFields['hailedChatLines'].type] = String(newCount)
                    } else {
                        newValue = ''
                    }

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['hailedChatLines'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = {guildId: guildId, cardIndex: cardIndex, newCount: newValue}
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_hailedChatLines_Success, fnFailure: postCardCustomFields_Failure, item: item})
                }

                //////////////////////////////////////////////////////////////////////
                ////   challengeCount
                ////////////////////////////////////////////////////////////////////// 
                if (guildsLatestData[guildId].cFields[logCustomFields['challengeCount'].id] != guildsLatestData[guildId].guild.challengeCount){
                    actionTakenInLoop = true   
			        if (gConfig.debug) consoleLogToFile('challengeCount(' + guildId + '): Action Taken. Set to Loop again')

                    var newValue = {}
                    newValue[logCustomFields['challengeCount'].type] = String(guildsLatestData[guildId].guild.challengeCount)

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['challengeCount'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_challengeCount_Success, fnFailure: postCardCustomFields_Failure, item: item})
                }  

                //////////////////////////////////////////////////////////////////////
                ////   challengesLeaderOnly
                ////////////////////////////////////////////////////////////////////// 
                if (String(guildsLatestData[guildId].cFields[logCustomFields['challengesLeaderOnly'].id]) != String(guildsLatestData[guildId].guild.leaderOnly.challenges)){
                    actionTakenInLoop = true   
			        if (gConfig.debug) consoleLogToFile('challengesLeaderOnly(' + guildId + '): Action Taken. Set to Loop again')

                    var newValue = {}
                    newValue[logCustomFields['challengesLeaderOnly'].type] = String(guildsLatestData[guildId].guild.leaderOnly.challenges)

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['challengesLeaderOnly'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_challengesLeaderOnly_Success, fnFailure: postCardCustomFields_Failure, item: item})
                }

                //////////////////////////////////////////////////////////////////////
                ////   privateGuild
                //////////////////////////////////////////////////////////////////////
                if (guildsLatestData[guildId].cFields[logCustomFields['privateGuild'].id].toString() != (guildsLatestData[guildId].guild.privacy != 'public').toString()){
                    actionTakenInLoop = true   
			        if (gConfig.debug) consoleLogToFile('privateGuild(' + guildId + '): Action Taken. Set to Loop again') 

                    var newValue = {}
                    newValue[logCustomFields['privateGuild'].type] = String((guildsLatestData[guildId].guild.privacy != 'public'))

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['privateGuild'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_privateGuild_Success, fnFailure: postCardCustomFields_Failure, item: item})
                }

                //////////////////////////////////////////////////////////////////////
                ////   gemCount
                ////////////////////////////////////////////////////////////////////// 
                if  ((guildsLatestData[guildId].cFields[logCustomFields['gemCount'].id] != guildsLatestData[guildId].guild.balance*`4`)){
                    actionTakenInLoop = true   
			        if (gConfig.debug) consoleLogToFile('gemCount(' + guildId + '): Action Taken. Set to Loop again')

                    var newValue = {}
                    newValue[logCustomFields['gemCount'].type] = String(guildsLatestData[guildId].guild.balance*4)

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['gemCount'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_gemCount_Success, fnFailure: postCardCustomFields_Failure, item: item})
                } 

                //////////////////////////////////////////////////////////////////////
                ////   lastUpdated
                ////////////////////////////////////////////////////////////////////// 
                //actionTakenInLoop = true   
			    if (gConfig.debug) consoleLogToFile('lastUpdated(' + guildId + '): No Action Taken. to avoid continues loop')

                var newValue = {}
                newValue[logCustomFields['lastUpdated'].type] = String(moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))

                ajaxRunningCount++
                var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['lastUpdated'].id + gConfig.logServerPathCustFieldItem
                var newData = {value: newValue}
                var item = obj
                callLast.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_lastUpdated_Success, fnFailure: postCardCustomFields_Failure, item: item})
            } 
        });

        call = call.concat(callLast)
        if (call.length > 0){
            makeAxiosCall(_.cloneDeep(call)) 
        } else {
            postCardCustomFields_Comp()
        }

        //////////////////////////////////////////////////////////////////////
        ////   Success Functions for Card Custom Fields
        ////////////////////////////////////////////////////////////////////// 
        function postCardCustomFields_guildNamePart1_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_guildNamePart1_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
            var newValue = {}
            newValue[logCustomFields['guildName'].type] =  guildsLatestData[item.guildId].guild.name 
            
            var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[item.cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['guildName'].id + gConfig.logServerPathCustFieldItem
            var newData = {value: newValue} 
            var item = {guildId: item.guildId, cardIndex: item.cardIndex} //respecified to remove guildId is false
            call_guildName.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_guildNamePart2_Success, fnFailure: postCardCustomFields_Failure, item: item})
            
            ajaxRunningCount_guildName--
            if (ajaxRunningCount_guildName == 0) makeAxiosCall(_.cloneDeep(call_guildName)) 
        }    

        function postCardCustomFields_guildNamePart2_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_guildNamePart2_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)

            guildsLatestData[item.guildId].cFields[logCustomFields['guildName'].id] = guildsLatestData[item.guildId].guild.name
            masterList[item.guildId].name = guildsLatestData[item.guildId].guild.name

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        } 

        function postCardCustomFields_guildCreated_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_guildCreated_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)

            if (guildsLatestData[item.guildId].cFields[logCustomFields['guildCreated'].id] != gConfig.masterDateNew){
                guildsLatestData[item.guildId].cFields[logCustomFields['guildCreated'].id] = gConfig.masterDateRoundUp
                masterList[item.guildId].created = gConfig.masterDateRoundUp
            } else {
                guildsLatestData[item.guildId].cFields[logCustomFields['guildCreated'].id] = moment().utc().format('YYYY-MM-DD')
                masterList[item.guildId].created = moment().utc().format('YYYY-MM-DD')
            }

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_memberCount_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_memberCount_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
                   
            guildsLatestData[item.guildId].cFields[logCustomFields['memberCount'].id] = guildsLatestData[item.guildId].guild.memberCount
            masterList[item.guildId].memberCount = guildsLatestData[item.guildId].cFields[logCustomFields['memberCount'].id] 

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_leaderIdPart1_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_leaderIdPart1_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)		

            var newValue = {}
            newValue[logCustomFields['leaderId'].type] = guildsLatestData[item.guildId].leader.id 
            
            var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[item.cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['leaderId'].id + gConfig.logServerPathCustFieldItem
            var newData = {value: newValue} 
            var item = {guildId: item.guildId, cardIndex: item.cardIndex} //respecified to remove leaderId is false
            call_leaderId.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCardCustomFields_leaderIdPart2_Success, fnFailure: postCardCustomFields_Failure, item: item})
            
            ajaxRunningCount_leaderId--
            if (ajaxRunningCount_leaderId == 0) makeAxiosCall(_.cloneDeep(call_leaderId)) 
        } 

        function postCardCustomFields_leaderIdPart2_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_leaderIdPart2_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)

            guildsLatestData[item.guildId].cFields[logCustomFields['leaderId'].id] = guildsLatestData[item.guildId].leader.id
            masterList[item.guildId].leader = guildsLatestData[item.guildId].leader.id
            
            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        } 

        function postCardCustomFields_leaderName_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_leaderName_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
                  
            guildsLatestData[item.guildId].cFields[logCustomFields['leaderName'].id] = guildsLatestData[item.guildId].leader.nameForLog 

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_leaderBorn_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_leaderBorn_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            guildsLatestData[item.guildId].cFields[logCustomFields['leaderBorn'].id] = guildsLatestData[item.guildId].leader.auth.timestamps.created

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_leaderLastLogin_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_leaderLastLogin_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
     
            guildsLatestData[item.guildId].cFields[logCustomFields['leaderLastLogin'].id] = guildsLatestData[item.guildId].leader.auth.timestamps.loggedin

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_chatLines_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_chatLines_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            guildsLatestData[item.guildId].cFields[logCustomFields['chatLines'].id] = guildsLatestData[item.guildId].guild.chat.length

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_chatLast_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_chatLast_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            if (guildsLatestData[item.guildId].guild.chat[0] != undefined){
                guildsLatestData[item.guildId].cFields[logCustomFields['chatLast'].id] = moment(guildsLatestData[item.guildId].guild.chat[0].timestamp).utc()
            } else {
                guildsLatestData[item.guildId].cFields[logCustomFields['chatLast'].id] = ''
            }

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_chatLast5_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_chatLast5_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            if (guildsLatestData[item.guildId].guild.chat[5] != undefined){
                guildsLatestData[item.guildId].cFields[logCustomFields['chatLast5'].id] = moment(guildsLatestData[item.guildId].guild.chat[5].timestamp).utc()
            } else {
                guildsLatestData[item.guildId].cFields[logCustomFields['chatLast5'].id] = ''
            }

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_chatLast20_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_chatLast20_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            if (guildsLatestData[item.guildId].guild.chat[20] != undefined){
                guildsLatestData[item.guildId].cFields[logCustomFields['chatLast20'].id] = moment(guildsLatestData[item.guildId].guild.chat[20].timestamp).utc()
            } else {
                guildsLatestData[item.guildId].cFields[logCustomFields['chatLast20'].id] = ''
            }

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_hailedChatLines_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_hailedChatLines_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            if (guildsLatestData[item.guildId].cFields[logCustomFields['hailedId'].id] != ''){
                guildsLatestData[item.guildId].cFields[logCustomFields['hailedChatLines'].id] = item.newCount
            } else {
                guildsLatestData[item.guildId].cFields[logCustomFields['hailedChatLines'].id] = ''
            }

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_challengeCount_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_challengeCount_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            guildsLatestData[item.guildId].cFields[logCustomFields['challengeCount'].id] = guildsLatestData[item.guildId].guild.challengeCount

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_challengesLeaderOnly_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_challengesLeaderOnly_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            guildsLatestData[item.guildId].cFields[logCustomFields['challengesLeaderOnly'].id] = guildsLatestData[item.guildId].guild.leaderOnly.challenges

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_privateGuild_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_privateGuildy_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            guildsLatestData[item.guildId].cFields[logCustomFields['privateGuild'].id] = (guildsLatestData[item.guildId].guild.privacy != 'public')        
            masterList[item.guildId].privacy = guildsLatestData[item.guildId].guild.privacy 

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_gemCount_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_gemCounty_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            guildsLatestData[item.guildId].cFields[logCustomFields['gemCount'].id] = guildsLatestData[item.guildId].guild.balance*4 

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_lastUpdated_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCardCustomFields_lastUpdated_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            guildsLatestData[item.guildId].cFields[logCustomFields['lastUpdated'].id] = moment().utc()

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        //////////////////////////////////////////////////////////////////////
        ////   Failure & Comp Functions for Card Custom Fields
        ////////////////////////////////////////////////////////////////////// 
        function postCardCustomFields_Failure(response, item, urlTo){
            consoleLogToFile('postCardCustomFields_Failure ******** ERROR for ' + item.guildId + '   url: ' + urlTo)

            ajaxRunningCount_failed.push(item.guildId)
            ajaxRunningCount--
            if (item.guildName == true){
                ajaxRunningCount_guildName--
                if ((ajaxRunningCount_guildName == 0) && (call_leaderId.length > 0)) makeAxiosCall(_.cloneDeep(call_guildName)) 
            }
            if (item.leaderId == true){
                ajaxRunningCount_leaderId--
                if ((ajaxRunningCount_leaderId == 0) && (call_leaderId.length > 0)) makeAxiosCall(_.cloneDeep(call_leaderId)) 
            }
            if (ajaxRunningCount == 0) postCardCustomFields_Comp()
        }

        function postCardCustomFields_Comp(){
            ajaxRunningCount_guildsToTest.forEach(function (obj, index){
                if ((guildsLatestData[obj.guildId].cFieldsStatus == 3) && (ajaxRunningCount_failed.indexOf(obj.guildId) < 0)){
                    guildsLatestData[obj.guildId].cFieldsStatus = 4
                } 
            }); 

            testCard()
        }

    }


    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////
    ////   Plot the course (Test the Card)               /////////////////
    ////                                                 /////////////////
    ////   cFieldsStatus4                                /////////////////
    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////
    function testCard(){
        if (gConfig.debug) consoleLogToFile('debug testCard');
        if (gConfig.debugConsole) console.log('Finally now we can really arrange these ships. (testCard)');                 
        var ajaxRunningCount = 0
        var call = []
        
        ajaxRunningCount_guildsToTest.forEach(function (obj, index){  
            var guildId = obj.guildId
            var cardIndex = obj.cardIndex

            if (guildsLatestData[guildId].cFieldsStatus == 4){
				//Default Action tokens
				//these are added here as they will be wiped if selected again
				obj.hailStatus = 0
				obj.listId = ''
				obj.textToPost = ''
				obj.dueDate = moment().utc().format('YYYY-MM-DD') 
				obj.cActionStatus = 6 //No action 
                obj.hailLang = [gConfig.hailLangDefault]

				/////////// Action Statsus
				/// cActionStatus = 0 post a Comment to the Card & Hail (If appropiate)
				///
				/// cActionStatus = 4 Update due date, labels and description - No need to do anything to the guild like hail.


                //////////////////////////////////////////////////////////////////////
                ////   Test if Sunk
                //////////////////////////////////////////////////////////////////////
                if (guilds_justId.indexOf(guildId) < 0){
                    if (gConfig.debug) consoleLogToFile('debug testCard: logListIdSunk: ' + guildId)
					obj.cActionStatus = 0
					obj.listId = logListIdSunk 
					obj.textToPost = gConfigText.msgLogSunk
                    obj.dueDate = '' //blank it out
                } else if (guildsLatestData[guildId].cFieldsStatus == 4){
					//Only move forward if we fetched everything
                    
                    //Determine commonTest Scenrios (This is to stop duplicate code below)
                    //if Active Comment (Set or remove) will fall to then ane and just test.
                    var flagBotLeader = (guildsBotLeader.indexOf(guildId) >= 0)

                    var flagMIA = (moment().utc().add(gConfig.dayETClearSailing_MIA*-1,'days').isAfter(guildsLatestData[guildId].cFields[logCustomFields['leaderLastLogin'].id])) 
 
                    if ((flagMIA == false) && (moment().utc().add(gConfig.dayETClearSailing_MIANoDrop*-1,'days').isAfter(guildsLatestData[guildId].leader.auth.timestamps.created))){

                        if (guildsLatestData[guildId].leader.items != undefined){
                            if (guildsLatestData[guildId].leader.items.lastDrop != undefined){
                                if (guildsLatestData[guildId].leader.items.lastDrop.date != undefined){
                                    flagMIA = (moment().utc().add(gConfig.dayETClearSailing_MIANoDrop*-1,'days').isAfter(guildsLatestData[guildId].leader.items.lastDrop.date))
                                    guildsLatestData[guildId].lastDropMIA = gConfig.msgLeaderDropMIA                                   
                                } else {
                                    flagMIA = true
                                    guildsLatestData[guildId].lastDropMIA = gConfig.msgLeaderDropNone 
                                }
                            } else {
                                flagMIA = true
                                guildsLatestData[guildId].lastDropMIA = gConfig.msgLeaderDropNone
                            }
                        } else {
                            flagMIA = true
                            guildsLatestData[guildId].lastDropMIA = gConfig.msgLeaderDropNone
                        }
                    }

                    var flagPrivateNavy = guildsLatestData[guildId].cFields[logCustomFields['privateGuild'].id] 
                    if ((flagPrivateNavy != true) && (flagPrivateNavy != 'true')) flagPrivateNavy = false //Sometimes there is a string here

                    var flagAdmiralReport = (guildsHasAdmiralReportLabel.indexOf(guildId) >= 0)
                    var flagDNH = guildsLatestData[guildId].habiticaOfficial
                    var flagNonEnglishHail = false
                    var flagCallForLastRites = false
                    var flagCallForReHail = false
                    var flagCallForDropAnchor = false
                    var flagSailToBermudaTriangle = false
                    var flagDropAnchor = false
                    var languagesCanHail = []
                    
                    cards[cardIndex].labels.forEach(function (obj2,index2){
                        if ((flagDNH == false) && (obj2.color == gConfig.labelColour_DNH) && (obj2.id != logLabelDNHOfficial) && (obj2.id != logLabelNonEnglishHail)) flagDNH = true  //Dont test for logLabelDNHOfficial again as it done above when setting the flag //Non English Hails tested after
                        if (obj2.id == logLabelNonEnglishHail) flagNonEnglishHail = true
                        if (obj2.id == logLabelCallForLastRites) flagCallForLastRites = true
                        if (obj2.id == logLabelCallForReHail) flagCallForReHail = true
                        if (obj2.id == logLabelCallForDropAnchor) flagCallForDropAnchor = true
                        if (obj2.id == logLabelSailToBermudaTriangle) flagSailToBermudaTriangle = true
                        if (obj2.id == logLabelDropAnchor) flagDropAnchor = true
                        if (obj2.color == gConfig.labelColour_Language) languagesCanHail.push(obj2.name.substring(0,2))
                    })

                    if ((flagDNH == false) && (flagNonEnglishHail == true) && (languagesCanHail.length > 0)){
                        flagDNH = true
                        obj.hailLang = [] //clear
                        languagesCanHail.forEach(function (obj2,index2){
                            if (gConfig.hailLangAvail.indexOf(obj2) >= 0){
                                flagDNH = false
                                obj.hailLang.push(obj2)
                            }
                        });
                        obj.hailLang.push([gConfig.hailLangDefault]) //add it to the end to hail so it always occurs
                    } 

                    var flagNoChatLines = (guildsLatestData[guildId].cFields[logCustomFields['chatLines'].id] == 0)
                    var flagLowActivity = ((guildsLatestData[guildId].cFields[logCustomFields['chatLines'].id] <= gConfig.lowActivityChatLines) && (masterList[guildId].memberCount <= gConfig.lowActivityMembers))

                    var flagTargetSpottedComp = (moment().utc().add(gConfig.dayETTargetSpotted*-1,'days').isAfter(guildsLatestData[guildId].cFields[logCustomFields['hailed'].id]))

                    if (gConfig.debug) consoleLogToFile('guild id: ' + guildId)
                    if (gConfig.debugVerbose) consoleLogToFile('card list: ' + cards[cardIndex].idList)
                    if (gConfig.debugVerbose) if (cards[cardIndex].idList == logListIdJustLaunched) consoleLogToFile('Just Launched')
                    if (gConfig.debugVerbose) if (cards[cardIndex].idList == logListIdClearSailing) consoleLogToFile('Clear Sailing')
                    if (gConfig.debugVerbose) if (cards[cardIndex].idList == logListIdTargetSpotted) consoleLogToFile('Target Spotted')
                    if (gConfig.debug) consoleLogToFile('Private Navy: ' + flagPrivateNavy)
                    if (gConfig.debugVerbose) consoleLogToFile('Admiral Report Flag:' + flagAdmiralReport)
                    if (gConfig.debugVerbose) consoleLogToFile('DNH Flag:' + flagDNH)
                    consoleLogToFile('Bot Leader: ' + flagBotLeader)
                    if (gConfig.debugVerbose) consoleLogToFile('Leader Last Login: ' + guildsLatestData[guildId].cFields[logCustomFields['leaderLastLogin'].id])
                    if (gConfig.debug) consoleLogToFile('MIA?: ' + flagMIA)           
                    if (gConfig.debugVerbose) consoleLogToFile('Hailed Date: ' + guildsLatestData[guildId].cFields[logCustomFields['hailed'].id])
                    if (gConfig.debugVerbose) consoleLogToFile('Test Time for Hail? ' + moment().utc().add(gConfig.dayETNoResponse*-1,'days').format('YYYY-MM-DDTHH:mm:ss.SSSZ'))

                    if (gConfig.debugVerbose) consoleLogToFile('Target Spotted to compare: ' +  moment().utc().add(gConfig.dayETTargetSpotted*-1,'days').format('YYYY-MM-DDTHH:mm:ss.SSSZ'))
                    if (gConfig.debugVerbose) consoleLogToFile('Created Date: ' + guildsLatestData[guildId].cFields[logCustomFields['guildCreated'].id])
                    if (gConfig.debugVerbose) consoleLogToFile('Hailed Chat Lines: ' + guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id])
                    if (gConfig.debugVerbose) consoleLogToFile('Chat Lines:' + guildsLatestData[guildId].cFields[logCustomFields['chatLines'].id])
                    if (gConfig.debugVerbose) consoleLogToFile('No Chat Lines: ' + flagNoChatLines)
                    if (gConfig.debugVerbose) consoleLogToFile('Low Activity: ' + flagLowActivity)
                    if (gConfig.debugVerbose) consoleLogToFile('Call for Rehail: ' + flagCallForReHail)
                    if (gConfig.debugVerbose) consoleLogToFile('Call for Last Rites: ' + flagCallForLastRites)
                    if (gConfig.debugVerbose) consoleLogToFile('Call for Drop Anchor: ' + flagCallForDropAnchor)
                    if (gConfig.debugVerbose) consoleLogToFile('Set Sail to Bermuda Triangle: ' + flagSailToBermudaTriangle)
                    if (gConfig.debugVerbose) consoleLogToFile('Drop Anchor: ' + flagDropAnchor)
                    if (gConfig.debugVerbose) consoleLogToFile('DNH: ' + flagDNH)

                    //////////////////////////////////////////////////////////////////////
                    ////   Warnings (Reported in Section 3)
                    //////////////////////////////////////////////////////////////////////
                    if (
                        (
                            (cards[cardIndex].idList == logListIdCaptainMIA) ||
                            (cards[cardIndex].idList == logListIdCaptured) ||
                            (cards[cardIndex].idList == logListIdLastRites)
                        ) && 
                        !(flagDropAnchor) && !(flagSailToBermudaTriangle)
                    ){
                        //check for too many chat lines
                        if (
                            (guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id] > gConfig.warningFastMovingChatLines) && 
                            (moment().utc().add(gConfig.warningFastMovingFromHail*-1,'days').isAfter(guildsLatestData[guildId].cFields[logCustomFields['hailed'].id]))
                        ){
                            if (reportWarningFastMoving.indexOf(guildId) < 0) reportWarningFastMoving.push(guildId)
                        } else if (guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id] > gConfig.warningHailAlmostInTheOcean){
                            if (reportWarningAlmostInTheOcean.indexOf(guildId) < 0) reportWarningAlmostInTheOcean.push(guildId)
                        }
                    }

                    //////////////////////////////////////////////////////////////////////
                    ////   Test if Do Not Hail 
                    //////////////////////////////////////////////////////////////////////
                    if (
                        (
                            (flagDNH) &&
                            ((flagBotLeader) || (flagMIA)) && //guild leader or Missing in Action
                            (cards[cardIndex].idList != logListIdDoNotHail)
                        )
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: Do Not Hail ' + guildId)
                        if (flagBotLeader){
                            obj.cActionStatus = 0
							obj.listId = logListIdDoNotHail 
							obj.textToPost = gConfigText.msgLogDoNotHailCaptured
                            obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD')
                        } else {
							obj.cActionStatus = 0
							obj.listId = logListIdDoNotHail 
							obj.textToPost = gConfigText.msgLogDoNotHailCaptainMIA
                            obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD')
                        }

                    //////////////////////////////////////////////////////////////////////
                    ////   Test if Last Rites 
					//////////////////////////////////////////////////////////////////////    
                    } else if (
                        ((flagBotLeader) || (flagMIA)) && 
                        (
                            (guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id] == 0) && 
                            (moment().utc().add(gConfig.dayETNoResponse*-1,'days').isAfter(guildsLatestData[guildId].cFields[logCustomFields['hailed'].id])) 
                        ) &&
                        ((cards[cardIndex].idList == logListIdCaptainMIA) || (cards[cardIndex].idList == logListIdCaptured)) &&
                        (!(flagCallForDropAnchor) && !(flagDropAnchor) && !(flagSailToBermudaTriangle))
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: Last Rites ' + guildId)
						obj.cActionStatus = 0
						obj.listId = logListIdLastRites 
						obj.textToPost = gConfigText.msgLogLastRitesNoResponse 
                        obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD')   

                    //////////////////////////////////////////////////////////////////////
                    ////   Test if Last Rites (No Chat) - Only move if in Target Spotted
                    ////////////////////////////////////////////////////////////////////// 
                    } else if (
                        ((flagBotLeader) || (flagMIA)) && 
                        (flagNoChatLines) &&
                        (
                            ((cards[cardIndex].idList == logListIdTargetSpotted) && (flagTargetSpottedComp)) 
                        )  &&
                        (!(flagCallForDropAnchor) && !(flagDropAnchor) && !(flagSailToBermudaTriangle))
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: Last Rites (No Chat) ' + guildId)
						obj.cActionStatus = 0
						obj.listId = logListIdLastRites 
						obj.textToPost = gConfigText.msgLogLastRitesNoChat
                        obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD')  

                    //////////////////////////////////////////////////////////////////////
                    ////   Test if Last Rites (Low Activity) - Only move if in Target Spotted
                    ////////////////////////////////////////////////////////////////////// 
                    } else if (
                        ((flagBotLeader) || (flagMIA)) && 
                        (flagLowActivity) &&
                        (
                            ((cards[cardIndex].idList == logListIdTargetSpotted) && (flagTargetSpottedComp))
                        )  &&
                        (!(flagCallForDropAnchor) && !(flagDropAnchor) && !(flagSailToBermudaTriangle))
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: Last Rites (Low Activity) ' + guildId)
						obj.cActionStatus = 0
						obj.listId = logListIdLastRites 
						obj.textToPost = gConfigText.msgLogLastRitesLowActivity
                        obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD')  

                    //////////////////////////////////////////////////////////////////////
                    ////   Call for Last Rites 
                    ////////////////////////////////////////////////////////////////////// 
                    } else if (
                        ((flagBotLeader) || (flagMIA)) && 
                        (flagCallForLastRites) &&
                        ((cards[cardIndex].idList == logListIdCaptainMIA) || (cards[cardIndex].idList == logListIdCaptured) || (cards[cardIndex].idList == logListIdTargetSpotted))  &&
                        (!(flagCallForDropAnchor) && !(flagDropAnchor) && !(flagSailToBermudaTriangle)) 
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: Called for Last Rites ' + guildId)
						obj.cActionStatus = 0
						obj.listId = logListIdLastRites 
						obj.textToPost = gConfigText.msgLogLastRitesCall  
                        obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD')
                        
                    //////////////////////////////////////////////////////////////////////
                    ////   Test if Captured (From Target Spotted)
                    ////////////////////////////////////////////////////////////////////// 
                    } else if (
                        (flagBotLeader) && 
                        (
                            (flagTargetSpottedComp) ||
                            (flagCallForReHail)
                        ) &&
                        (cards[cardIndex].idList == logListIdTargetSpotted)  &&
                        (!(flagCallForDropAnchor) && !(flagDropAnchor) && !(flagSailToBermudaTriangle)) 
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: Bot Leader ' + guildId)
						obj.cActionStatus = 0
						obj.listId = logListIdCaptured 
						obj.textToPost = gConfigText.msgLogCaptured  
                        obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD')
						
                    //////////////////////////////////////////////////////////////////////
                    ////   Test if Captured (From MIA)
                    ////////////////////////////////////////////////////////////////////// 
                    } else if (
                        (flagBotLeader) && 
                        (cards[cardIndex].idList == logListIdCaptainMIA)  &&
                        (!(flagCallForDropAnchor) && !(flagDropAnchor) && !(flagSailToBermudaTriangle)) 
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: Bot Leader From MIA Captain left guild (No need to ReHail) ' + guildId)
						obj.cActionStatus = 4
						obj.listId = logListIdCaptured 
						obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD') 

                    //////////////////////////////////////////////////////////////////////
                    ////   Test if MIA
                    ////////////////////////////////////////////////////////////////////// 
                    } else if (
                        (flagMIA) && 
                        (
                            (flagTargetSpottedComp) ||
                            (flagCallForReHail)
                        ) &&
                        (cards[cardIndex].idList == logListIdTargetSpotted)  &&
                        (!(flagCallForDropAnchor) && !(flagDropAnchor) && !(flagSailToBermudaTriangle))
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: Captain MIA ' + guildId)
						obj.cActionStatus = 0
						obj.listId = logListIdCaptainMIA 
						obj.textToPost = gConfigText.msgLogCaptainMIA
                        obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD')
                    
                    //////////////////////////////////////////////////////////////////////
                    ////   Test if Target Spotted
                    ////////////////////////////////////////////////////////////////////// 
                    } else if (
                        (
                            ((flagBotLeader) || (flagMIA)) && //guild leader or Missing in Action
                            (
                                (cards[cardIndex].idList == logListIdJustLaunched) ||
                                (cards[cardIndex].idList == logListIdClearSailing) ||
                                ((cards[cardIndex].idList == logListIdDoNotHail) && !(flagDNH))
                            )
                        ) ||
                        (
                            (flagBotLeader) && 
                            (cards[cardIndex].idList == logListIdPrivateNavy) //Do not care if leader is MIA if private
                        )
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: TargetSpotted ' + guildId)
                        obj.cActionStatus = 0
						obj.listId = logListIdTargetSpotted 
						obj.textToPost = ''
                        obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD')

                    //////////////////////////////////////////////////////////////////////
                    ////   Test if in Private Guild
                    ////////////////////////////////////////////////////////////////////// 
                    } else if (
                        !(flagBotLeader) &&
                        (flagPrivateNavy) &&
                        (cards[cardIndex].idList != logListIdPrivateNavy)
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: Private Guild - No need to hail as manual intervention has occurred ' + guildId)
if (gConfig.debug) consoleLogToFile( '!(flagBotLeader)' + !(flagBotLeader))
if (gConfig.debug) consoleLogToFile( '(flagPrivateNavy)' + (flagPrivateNavy) )
if (gConfig.debug) consoleLogToFile( '(cards[cardIndex].idList != logListIdPrivateNavy)) '+ (cards[cardIndex].idList != logListIdPrivateNavy))
if (gConfig.debug) consoleLogToFile((
                        !(flagBotLeader) &&
                        (flagPrivateNavy) &&
                        (cards[cardIndex].idList != logListIdPrivateNavy)
                    ))
                        obj.cActionStatus = 0
						obj.listId = logListIdPrivateNavy 
						obj.textToPost = ''
                        obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD')

                    //////////////////////////////////////////////////////////////////////
                    ////   Test if Clear Sailing (from MIA or Bot)
                    ////////////////////////////////////////////////////////////////////// 
                    } else if (
                        !(flagBotLeader) &&
                        !(flagMIA) && 
                        !(flagPrivateNavy) &&
                        (cards[cardIndex].idList != logListIdJustLaunched) &&
                        (cards[cardIndex].idList != logListIdClearSailing)
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: Clear Sailing now ' + guildId)
						if (cards[cardIndex].idList != logListIdPrivateNavy){
                            obj.cActionStatus = 0 
                        } else {
                            obj.cActionStatus = 4
                        }
						obj.listId = logListIdClearSailing 
						if (cards[cardIndex].idList != logListIdPrivateNavy) obj.textToPost = gConfigText.msgLogClearSailing 
                        obj.dueDate = moment(guildsLatestData[guildId].cFields[logCustomFields['leaderLastLogin'].id]).utc().add(gConfig.dayETClearSailing_Check,'days').format('YYYY-MM-DD')                  

                    //////////////////////////////////////////////////////////////////////
                    ////   Test if Clear Sailing (from Just Launched)
                    ////////////////////////////////////////////////////////////////////// 
                    } else if (
                        !(flagBotLeader) &&
                        !(flagMIA) && 
                        !(flagPrivateNavy) &&
                        (moment().utc().add(gConfig.dayETJustLaunched * -1,'days').isAfter(guildsLatestData[guildId].cFields[logCustomFields['guildCreated'].id])) &&
                        (cards[cardIndex].idList == logListIdJustLaunched)  &&
                        (!(flagCallForDropAnchor) || !(flagDropAnchor)) && //Cant go to Bermuda as the captain is active
                        !(flagAdmiralReport) 
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: Clear Sailing now (from Just Launched) ' + guildId)
                        obj.cActionStatus = 0
						obj.listId = logListIdClearSailing 
						obj.textToPost = ''
                        obj.dueDate = moment(guildsLatestData[guildId].cFields[logCustomFields['leaderLastLogin'].id]).utc().add(gConfig.dayETClearSailing_Check,'days').format('YYYY-MM-DD')

                    //////////////////////////////////////////////////////////////////////
                    ////   ReHail MIA or Bot Leader if hail fallen off
                    ////////////////////////////////////////////////////////////////////// 
                    } else if (
                        (guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id] < 0) &&
                        ((cards[cardIndex].idList == logListIdCaptainMIA) || (cards[cardIndex].idList == logListIdCaptured))  &&
                        (!(flagCallForDropAnchor) && !(flagDropAnchor) && !(flagSailToBermudaTriangle))
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: ReHail guild - missing ' + guildId)
                        if (reportWarningReHail.indexOf(guildId) < 0)  reportWarningReHail.push(guildId)
						obj.cActionStatus = 0
						obj.listId = cards[cardIndex].idList 
						obj.textToPost = gConfigText.msgLogReHail 
                        obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD')

                    //////////////////////////////////////////////////////////////////////
                    ////   ReHail MIA or Bot Leader due to label
                    ////////////////////////////////////////////////////////////////////// 
                    }  else if (
                        (flagCallForReHail) &&
                        ((cards[cardIndex].idList == logListIdCaptainMIA) || (cards[cardIndex].idList == logListIdCaptured) || (cards[cardIndex].idList == logListIdLastRites))  &&
                        (!(flagCallForDropAnchor) && !(flagDropAnchor) && !(flagSailToBermudaTriangle))
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: ReHail guild - Called by label ' + guildId)
                        if (flagMIA){
                            obj.cActionStatus = 0
							obj.listId = logListIdCaptainMIA
							obj.textToPost = gConfigText.msgLogReHail
                        } else {
                            obj.cActionStatus = 0
							obj.listId = logListIdCaptured
							obj.textToPost = gConfigText.msgLogReHail
                            obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD')
                        }

                    //////////////////////////////////////////////////////////////////////
                    ////   Call for Long Pause (Set Bermuda Triangle)
                    ////////////////////////////////////////////////////////////////////// 
                    }  else if (
                        (flagSailToBermudaTriangle) &&
                        (cards[cardIndex].idList != logListIdClearSailing) &&
                        (cards[cardIndex].idList != logListIdPrivateNavy)
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: Sail to Bermuda Triangle ' + guildId)
                        obj.cActionStatus = 0
						obj.listId = logListIdBermudaTriangle
						obj.textToPost = gConfigText.msgLogSetSailBermudaTriangle
                        obj.dueDate = moment().utc().add(gConfig.dayBermudaTriangle,'days').format('YYYY-MM-DD')


                    //////////////////////////////////////////////////////////////////////
                    ////   Call for Short Pause (Drop Anchor) 
                    ////////////////////////////////////////////////////////////////////// 
                    }  else if (
                        (flagCallForDropAnchor) &&
                        (cards[cardIndex].idList != logListIdClearSailing) &&
                        (cards[cardIndex].idList != logListIdPrivateNavy) 
                    ){
                        if (gConfig.debug) consoleLogToFile('debug testCard: Call to Drop the Anchor ' + guildId)
                        obj.cActionStatus = 0
						obj.listId = cards[cardIndex].idList
                        obj.textToPost = gConfigText.msgLogDropAnchor
                        obj.dueDate = moment().utc().add(gConfig.dayDropAnchor,'days').format('YYYY-MM-DD')

                    //////////////////////////////////////////////////////////////////////
                    ////   Raise Anchour or keep going? 
                    ////////////////////////////////////////////////////////////////////// 
                    }  else if (
                        (flagDropAnchor) &&
                        (cards[cardIndex].idList != logListIdClearSailing) &&
                        (cards[cardIndex].idList != logListIdPrivateNavy) 
                    ){
                        if (moment().utc().add(0, 'days').isAfter(cards[cardIndex].due)){
                            if (gConfig.debug) consoleLogToFile('debug testCard: Time to Raise the Anchor ' + guildId)
							obj.cActionStatus = 0
							obj.listId = cards[cardIndex].idList
							obj.textToPost = gConfigText.msgLogRaiseAnchor
                            obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD')
                        } else {
                            if (gConfig.debug) consoleLogToFile('debug testCard: Anchor dropped - paused ' + guildId)
                            obj.cActionStatus = 4
							obj.listId = cards[cardIndex].idList
							obj.dueDate = cards[cardIndex].dueDate
                        }

                    //////////////////////////////////////////////////////////////////////
                    ////   Found guild. (Card was in Sunk and not move any previous list)
                    ////////////////////////////////////////////////////////////////////// 
                    } else if (
                        (guilds_justId.indexOf(guildId) >= 0) &&
                        (cards[cardIndex].idList == logListIdSunk)
                    ){
                        actionTakenInLoop = true //Force Reloop if single guild
                        if (gConfig.debug) consoleLogToFile('Found Card: Action Taken. Set to Loop again') 
                        guildsLatestData[guildId].cFieldsStatus = 0 // Reset to go again
						obj.cActionStatus = 4
						obj.listId = logListIdJustLaunched
						obj.dueDate = moment().utc().add(0,'days').format('YYYY-MM-DD')
							
                    //////////////////////////////////////////////////////////////////////
                    ////   No Change Add 1 day unless Clear Sailing
                    ////////////////////////////////////////////////////////////////////// 
                    } else {
                        if (gConfig.debug) consoleLogToFile('debug testCard: No need to move card ' + guildId) 

                        if (cards[cardIndex].idList == logListIdClearSailing){
                            if (gConfig.debug) consoleLogToFile('debug testCard: Private or Clear Sailing guild - Determine Date ' + guildId)

                            if (moment().utc().add(gConfig.dayETClearSailing_MaybeMIA*-1 + 1,'days').isAfter(guildsLatestData[guildId].cFields[logCustomFields['leaderLastLogin'].id])){ 
                                obj.cActionStatus = 4
								obj.listId = cards[cardIndex].idList
								obj.dueDate = moment(guildsLatestData[guildId].cFields[logCustomFields['leaderLastLogin'].id]).add(gConfig.dayETClearSailing_MIA + 1,'days').format('YYYY-MM-DD') //add one day to ensure when testing next Leader is really away
                            } else if (moment().utc().add(gConfig.dayETClearSailing_Check*-1 + 1,'days').isAfter(guildsLatestData[guildId].cFields[logCustomFields['leaderLastLogin'].id])){
								obj.cActionStatus = 4
								obj.listId = cards[cardIndex].idList
								obj.dueDate = moment(guildsLatestData[guildId].cFields[logCustomFields['leaderLastLogin'].id]).add(gConfig.dayETClearSailing_MaybeMIA,'days').format('YYYY-MM-DD') 
                            } else {
                                clearCountLoad++
                                if (clearCountLoad >  gConfig.clearCountLoadPercent/100 * guilds_justId.length) {
                                    if (gConfig.debugVerbose) consoleLogToFile('debug testCard: Too many Clear Sailing Ships. Adding 1 more day to check. Load Count: ' + clearCountLoad + ' Number of Guilds: ' + guilds_justId.length)
                                    gConfig.dayETClearSailing_Check++ // This is naughty but I didn't want another global variable
                                    clearCountLoad = 0
                                }

								obj.cActionStatus = 4
								obj.listId = cards[cardIndex].idList
								obj.dueDate = moment(guildsLatestData[guildId].cFields[logCustomFields['leaderLastLogin'].id]).add(gConfig.dayETClearSailing_Check,'days').format('YYYY-MM-DD') //To avoid future bumping.
                            }
                        } else if (cards[cardIndex].idList == logListIdPrivateNavy){
                            //Do not base on leader login as leader likely be MIA. Just every gConfig.dayETClearSailing_Check
							obj.cActionStatus = 4
							obj.listId = cards[cardIndex].idList
							obj.dueDate = moment().utc().add(gConfig.dayETClearSailing_Check,'days').format('YYYY-MM-DD') 
                        } else {
                            if (gConfig.debug) consoleLogToFile('debug testCard: Add 1 day and check tomorrow ' + guildId) 
							obj.cActionStatus = 4
							obj.listId = cards[cardIndex].idList
							obj.dueDate = moment().utc().add(1,'days').format('YYYY-MM-DD') 
                        }
                    } //No change
                } 
            }
        });
        prep4Hail()
        if (gConfig.debug) consoleLogToFile('debug testCard END');
    }//testCard


    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////
    ////   Cast away and complete the actions            /////////////////
    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////


    //////////////////////////////////////////////////////////////////////
    ////   Prep hailing guild
    ////   Only perform if required
    ////    - Add Comment
    ///     - Add action dates
    ////    - Enable challenges 
    ///    cActionStatus0
    //////////////////////////////////////////////////////////////////////
    function prep4Hail(guildId, cardIndex, listId, textToPost){
        if (gConfig.debug) consoleLogToFile('debug prep4Hail START');

        var ajaxRunningCount = 0
        var ajaxRunningCount_failed = []
        var call = []

        ajaxRunningCount_guildsToTest.forEach(function (obj, index){  
            var guildId = obj.guildId
            var cardIndex = obj.cardIndex
            var listId = obj.listId
            var textToPost = obj.textToPost

            if (obj.cActionStatus == 0){
                //Comment of Action (Only comment if we have not hailed)
                if (((textToPost != undefined) && (textToPost != '')) &&
                    ((guildsLatestData[guildId].hailStatus == 0) || (guildsLatestData[guildId].hailStatus == undefined))
                ){
                    if (gConfig.debug) consoleLogToFile('debug prep4HailPostComment START for ' + guildId);
                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathComment
                    textToPost = prepChatHail(textToPost)
                    var newData = {text: textToPost}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: prep4HailPostComment_Success, fnFailure: prep4Hail_Failure, item: item})
                }

                //Action Started
                if ((
                        (
                            (listId == logListIdCaptainMIA) ||
                            (listId == logListIdCaptured) ||
                            (listId == logListIdLastRites) ||
                            (listId == logListIdDoNotHail) 
                        ) &&
                        (
                            (cards[cardIndex].idList != logListIdCaptainMIA) &&
                            (cards[cardIndex].idList != logListIdCaptured) &&
                            (cards[cardIndex].idList != logListIdLastRites) &&
                            (cards[cardIndex].idList != logListIdDoNotHail) 
                        )
                    ) 
                ){ 
                    if (gConfig.debug) consoleLogToFile('debug prep4HailPostActionStarted START for ' + guildId); 
                    var newValue = {}
                    newValue[logCustomFields['actionStarted'].type] = String(moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))
                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['actionStarted'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: prep4HailPostActionStarted_Success, fnFailure: prep4Hail_Failure, item: item})
                }                   
                //Action Finish
                if (
                    (
                        (listId != logListIdCaptainMIA) &&
                        (listId != logListIdCaptured) &&
                        (listId != logListIdLastRites) &&
                        (listId != logListIdDoNotHail) &&
                        (listId != logListIdTargetSpotted)
                    ) &&
                    (
                        (cards[cardIndex].idList == logListIdCaptainMIA) ||
                        (cards[cardIndex].idList == logListIdCaptured) ||
                        (cards[cardIndex].idList == logListIdLastRites) ||
                        (cards[cardIndex].idList == logListIdDoNotHail) ||
                        (cards[cardIndex].idList == logListIdTargetSpotted) 
                    )
                ){
                    if (gConfig.debug) consoleLogToFile('debug prep4HailPostActionFinished START for ' + guildId); 
                    var newValue = {}
                    newValue[logCustomFields['actionFinished'].type] = String(moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ')) 
                    
                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['actionFinished'].id + gConfig.logServerPathCustFieldItem
                    var newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: prep4HailPostActionFinished_Success, fnFailure: prep4Hail_Failure, item: item})
                }    
            }   
        });
        if (call.length > 0){
            makeAxiosCall(_.cloneDeep(call)) 
        } else {
            prep4Hail_Comp()
        }

        function prep4HailPostComment_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug prep4HailPostCommnet_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            ajaxRunningCount--
            if (ajaxRunningCount == 0) prep4Hail_Comp()
        }

        function prep4HailPostActionStarted_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug prep4HailPostActionStarted_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            if (item.listId != logListIdSunk) guildsLatestData[item.guildId].cFields[logCustomFields['actionStarted'].id] = String(moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ')) 

            ajaxRunningCount--
            if (ajaxRunningCount == 0) prep4Hail_Comp()
        }


        function prep4HailPostActionFinished_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug prep4HailPostActionFinished_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
  
            if (item.listId != logListIdSunk) guildsLatestData[item.guildId].cFields[logCustomFields['actionFinished'].id]  = String(moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ')) 
                
            ajaxRunningCount--
            if (ajaxRunningCount == 0) prep4Hail_Comp()
        }

        function prep4Hail_Failure(response, item, urlTo){
            consoleLogToFile('postCardCustomFields_Failure ******** ERROR for ' + item.guildId + '   url: ' + urlTo)
            ajaxRunningCount_failed.push(item.guildId)
            ajaxRunningCount--
            if (ajaxRunningCount == 0) prep4Hail_Comp()
        }

        function prep4Hail_Comp(){
            ajaxRunningCount_guildsToTest.forEach(function (obj, index){
                if ((obj.cActionStatus == 0) && (ajaxRunningCount_failed.indexOf(obj.guildId) < 0)){        obj.cActionStatus = 1
                } 
            }); 
            postElf()            
        }
        //if (gConfig.debug) consoleLogToFile('debug prep4Hail END');
    } //prep4Hail


    //////////////////////////////////////////////////////////////////////
    ////   Elven Challenges
    ////   Only perform if required
    ////    - Enable Challenges
    ///     - Fetch Challenges & Hail with Elf
    ///    cActionStatus1
    //////////////////////////////////////////////////////////////////////
    function postElf(){
        if (gConfig.debug) consoleLogToFile('debug postElf START');

        var ajaxRunningCount = 0
        var ajaxRunningCount_fetchChallenge=0
        var ajaxRunningCount_failed = []
        var call = []
        var call_fetchChallenge = []

        ajaxRunningCount_guildsToTest.forEach(function (obj, index){  
            var guildId = obj.guildId
            var cardIndex = obj.cardIndex
            var listId = obj.listId
            var textToPost = obj.textToPost
            var dueDate = obj.dueDate

            if (obj.cActionStatus == 1 && (listId != logListIdSunk)){
                //Enable Challenges
                if (
                    (guildsLatestData[guildId].cFields[logCustomFields['challengesLeaderOnly'].id] == true) &&
                    (
                        (listId == logListIdTargetSpotted) ||
                        (listId == logListIdCaptainMIA) ||
                        (listId == logListIdCaptured) ||
                        (listId == logListIdLastRites)
                    ) &&
                    ( 
                        (guildsBotLeader.indexOf(guildId) >= 0) ||
                        (userIsAdmin)
                    )
                ){
                    actionTakenInLoop = true  
		            if (gConfig.debug) consoleLogToFile('postElfEnableChallenge: Action Taken. Set to Loop again')

                    ajaxRunningCount++
                    var urlToAction = gConfig.botServerUrl + gConfig.botServerPathGroup + '/' + guildId   
                    var newData = {leaderOnly: {challenges: false}}
                    var item = obj
                    call.push({targetType: 'bot', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postElfEnableChallenge_Success, fnFailure: postElf_Failure, item: item})
                }

                //Fetch Challenges & Hail Elf
                if (
                    (listId == logListIdLastRites) &&
                    (cards[cardIndex].idList != logListIdLastRites) &&
                    ((guildsLatestData[guildId].elfHail == undefined) || (guildsLatestData[guildId].elfHail != true)) && //Don't hail twice
                    (guildsLatestData[guildId].cFields[logCustomFields['challengeCount'].id] != 0) 
                ){
                    ajaxRunningCount++
                    ajaxRunningCount_fetchChallenge++
                    var urlToAction = gConfig.botServerUrl + gConfig.botServerPathChallengeGroup + '/' + guildId
                    var newData = {leaderOnly: {challenges: false}}
                    var item = obj
                    call.push({targetType: 'bot', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: postElfFetchChallenge_Success, fnFailure: postElf_Failure, item: item})                        
                }
            }
        });
        if (call.length > 0){
            makeAxiosCall(_.cloneDeep(call)) 
        } else {
            postElf_Comp()
        }

        function postElfEnableChallenge_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postElfEnableChallenge_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            if (obj.listId != logListIdSunk) guildsLatestData[guildId].guild.leaderOnly.challenges = false

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postElf_Comp()
        }

        function postElfFetchChallenge_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postElfFetchChallenge_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            var guildId = item.guildId
			var cardIndex = item.cardIndex
			var listId = item.listId
			var dueDate = item.dueDate

            guildsLatestData[guildId].challenge = data

            //Not worrying to fetch again because if there is more than 10 not going to fit. 
            if ( guildsLatestData[guildId].challenge.length > 0 ){
                var chatMessageToAdd = ''
                var chatMessage = gConfigText.msghailElf1 + '[' + guildsLatestData[guildId].guild.name + '](' + gConfig.habiticaGuildUrl + guildId + ')' + gConfigText.msghailElf2 
                var tooLong = false

                var callHailElf = []
                guildsLatestData[guildId].challenge.forEach(function (obj,index){
                    chatMessageToAdd = '\n+ [' + obj.name + '](' + gConfig.habiticaChallengeUrl + obj.id + ') **Created:** ' + moment(obj.createdAt).utc().format('D MMM YYYY') + ' **Participants:** ' + obj.memberCount + ' **Gems:** ' + obj.prize + ' **Owner:** ' 

                    if (obj.leader != undefined){
                        if (obj.leader.auth != undefined && obj.leader.auth.local != undefined && obj.leader.auth.local.username != undefined){
                            chatMessageToAdd += '[' + obj.leader.auth.local.username
                        } else
                        {
                            chatMessageToAdd += '[' + gConfigText.msgUserNameNotSet + obj.leader.profile.name
                        }
                        chatMessageToAdd += '](' + gConfig.habiticaProfileUrl + obj.leader.id + ')' 
                    } else {
                        chatMessageToAdd += gConfigText.msgNoOwner
                    }
                    
                    if (chatMessage.length + chatMessageToAdd.length > gConfig.chatMessageLengthMax - gConfigText.msghailElf_tooMany.length){
                        tooLong = true
                    } else {
                        chatMessage += chatMessageToAdd
                    }
                });
                
                if (tooLong) chatMessage += gConfigText.msghailElf_tooMany

                ajaxRunningCount++
                var urlToAction = gConfig.botServerUrl + gConfig.botServerPathGroup + '/' + gConfig.botGuildElf  + gConfig.botServerPathChat 
                if (gConfig.botAllOutputToReport){
                    urlToAction = gConfig.botServerUrl + gConfig.botServerPathGroup + '/' + gConfig.botGuildReport  + gConfig.botServerPathChat
                    chatMessage = 'HAIL TO BE POSTED TO [Elven Grove](' + gConfig.habiticaGuildUrl + gConfig.botGuildElf + ')\n\n' + chatMessage
                }
                chatMessage = prepChatHail(chatMessage)
                if (chatMessage.length > gConfig.chatMessageLengthMax) chatMessage = chatMessage.substring(0,gConfig.chatMessageLengthMax) //catch all
                var newData = {message: chatMessage}
                var item = item
                callHailElf.push({targetType: 'bot', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postElfHail_Success, fnFailure: postElf_Failure, item: item})         
            }    

            ajaxRunningCount--
            ajaxRunningCount_fetchChallenge--
            if (ajaxRunningCount_fetchChallenge == 0) if (callHailElf.length > 0) makeAxiosCall(_.cloneDeep(callHailElf))
            if (ajaxRunningCount == 0) postElf_Comp()
        }

        function postElfHail_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postElfHail_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)

            //force this information to force update and avoid fetch
            guildsLatestData[item.guildId].elfHail = true

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postElf_Comp()
        }

        function postElf_Failure(response, item, urlTo){
            consoleLogToFile('postCardCustomFields_Failure ******** ERROR for ' + item.guildId + '   url: ' + urlTo)
            ajaxRunningCount_failed.push(item.guildId)
            if (item.fetchChallenge == true){
                ajaxRunningCount_fetchChallenge--
                if (ajaxRunningCount_fetchChallenge == 0) makeAxiosCall(_.cloneDeep(call_fetchChallenge)) 
            }
            ajaxRunningCount--
            if (ajaxRunningCount == 0) postElf_Comp()
        }

        function postElf_Comp(){
            ajaxRunningCount_guildsToTest.forEach(function (obj, index){
                if ((obj.cActionStatus == 1) && (ajaxRunningCount_failed.indexOf(obj.guildId) < 0)){
                    obj.cActionStatus = 2
                } 
            }); 
            postHail()            
        }
        //if (gConfig.debug) consoleLogToFile('debug postElf END ');
    } //postElf


    //////////////////////////////////////////////////////////////////////
    ////   Hailing guild
    ////   Only perform if required
    ////    - Hail Guild 
    ///    cActionStatus2
    //////////////////////////////////////////////////////////////////////
    function postHail(){
        if (gConfig.debug) consoleLogToFile('debug postHail START');

        var ajaxRunningCount = 0
        ajaxRunningCount_failed = []
        var call = []

        ajaxRunningCount_guildsToTest.forEach(function (obj, index){  
            var guildId = obj.guildId
            var cardIndex = obj.cardIndex
            var listId = obj.listId
            var textToPost = obj.textToPost
            var dueDate = obj.dueDate

            if ((obj.cActionStatus == 2) && (listId != logListIdSunk)){
                //Hail if needed 
                if (
                    (guildsLatestData[guildId].hailStatus == 0) && 
                    (
                        (
                            (
                                (cards[cardIndex].idList == logListIdCaptainMIA) || 
                                (cards[cardIndex].idList == logListIdCaptured) ||
                                (cards[cardIndex].idList == logListIdLastRites)
                            ) &&
                            ((listId == logListIdClearSailing) || (listId == logListIdBermudaTriangle)) //Hail should not occur when going for Private Navy as leader may not returned
                        ) || 
                        ((listId != logListIdClearSailing) &&  (listId != logListIdJustLaunched) && (listId != logListIdPrivateNavy) && (listId != logListIdBermudaTriangle))
                    ) &&
                    (
                        listId != logListIdTargetSpotted
                    ) &&
                    (
                        listId != logListIdDoNotHail
                    ) &&
                    (
                        (guildsLatestData[guildId].cFields[logCustomFields['challengesLeaderOnly'].id] != true) ||
                        (
                            (listId != logListIdCaptured) && 
                            !((listId == logListIdCaptainMIA) && (userIsAdmin))
                        )
                    ) &&
                    (
                        (listId != logListIdLastRites) ||
                        (cards[cardIndex].idList == logListIdLastRites) ||
                        (guildsLatestData[guildId].cFields[logCustomFields['challengeCount'].id] == 0) ||
                        (guildsLatestData[guildId].elfHail == true) 
                    )
                ){
                    actionTakenInLoop = true 
                    if (gConfig.debug) consoleLogToFile('Hailing Guild: Action Taken. Set to Loop again' + obj.id)	
                    var chatMessage = []

                    if (listId == cards[cardIndex].idList){
                        //determine if pause or rehail
                        var flagCallForDropAnchor = false
                        var flagDropAnchor = false

                        cards[cardIndex].labels.forEach(function (obj,index){
                            if (obj.id == logLabelCallForDropAnchor) flagCallForDropAnchor = true
                            if (obj.id == logLabelDropAnchor) flagDropAnchor = true
                        })

                        if (flagCallForDropAnchor){        
                            chatMessage.push('hailDropAnchor')
                        } else if (flagDropAnchor){
                            //Raise Anchor
                            chatMessage.push('hailRaiseAnchor')
                        } else {
                            //assume rehail
                            chatMessage.push('hailReHail')
                        }
                    } else {
                        switch(listId){
                            case logListIdCaptainMIA:
                                chatMessage.push('hailCapatainMIA')
                                break;
                            case logListIdCaptured:
                                chatMessage.push('hailCaptured')
                                break;
                            case logListIdLastRites:
                                if (guildsLatestData[guildId].cFields[logCustomFields['chatLines'].id] == 0){
                                    chatMessage.push('hailLastRites_NoChat')
                                } else if ((guildsLatestData[guildId].cFields[logCustomFields['chatLines'].id] <= gConfig.lowActivityChatLines) && (masterList[guildId].memberCount <= gConfig.lowActivityMembers)){
                                    chatMessage.push('hailLastRites_LowActivity')
                                } else if (
                                    (cards[cardIndex].idList != logListIdCaptainMIA) &&
                                    (cards[cardIndex].idList != logListIdCaptured)
                                ){
                                    //Assume Last Rites call message has been applied.
                                    chatMessage.push('hailLastRites_Call')
                                } else {
                                    chatMessage.push('hailLastRites')
                                }
                                if (guildsBotLeader.indexOf(guildId) < 0) chatMessage.push('hailLastRites_gemsReturned')
                                if  (guildsLatestData[guildId].cFields[logCustomFields['chatLines'].id] != 0)  chatMessage.push('hailLastRites_exportChat')
                                break;
                            case logListIdBermudaTriangle:
                                chatMessage.push('hailBermudaTriangle')
                            default:
                                // assume logListIdClearSailing
                                chatMessage.push('hailClearSailing')
                        }
                    }

                    if (chatMessage.length > 0){
                        obj.hailLang.forEach(function (obj2, index2){
                                var txtToSend = ''
                                chatMessage.forEach(function (obj3, index3){ 
                                    txtToSend += hailLang[obj2][obj3]
                                });

                                ajaxRunningCount++
                                var urlToAction = gConfig.botServerUrl + gConfig.botServerPathGroup + '/' + guildId  + gConfig.botServerPathChat 
                                if (gConfig.botAllOutputToReport){
                                    urlToAction = gConfig.botServerUrl + gConfig.botServerPathGroup + '/' + gConfig.botGuildReport  + gConfig.botServerPathChat
                                    txtToSend = 'HAIL TO BE POSTED TO [' + guildsLatestData[guildId].guild.name + '](' + gConfig.habiticaGuildUrl + guildId + ')\n\n' + txtToSend
                                }
                                txtToSend = prepChatHail(txtToSend)
                                txtToSend = txtToSend.substring(0, gConfig.chatMessageLengthMax)
                                newData = {message: txtToSend}
                                var item = obj
                                if (txtToSend != '') call.push({targetType: 'bot', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postHail_Success, fnFailure: postHail_Failure, item: item})
                        });
                    }
                } 
            }
        });
        if (call.length > 0){
            makeAxiosCall(_.cloneDeep(call)) 
        } else {
            postHail_Comp()
        }

        function postHail_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postHail_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            if (item.listId != logListIdSunk) guildsLatestData[item.guildId].hailData = data.message
            guildsLatestData[item.guildId].hailStatus = 1 //Record Hail is completed. Needs to be permanent in case of loop/error

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postHail_Comp()
        }    

        function postHail_Failure(response, item, urlTo){
            consoleLogToFile('postHail_Failure ******** ERROR for ' + item.guildId + '   url: ' + urlTo)
            ajaxRunningCount_failed.push(item.guildId)
            ajaxRunningCount--
            if (ajaxRunningCount == 0) postHail_Comp()
        }

        function postHail_Comp(){
            ajaxRunningCount_guildsToTest.forEach(function (obj, index){
                if ((obj.cActionStatus == 2) && (ajaxRunningCount_failed.indexOf(obj.guildId) < 0)){
                    obj.cActionStatus = 3
                } 
            }); 
            postRecord()            
        }
        //if (gConfig.debug) consoleLogToFile('debug postHail END ');
    } //postHail
      
    //////////////////////////////////////////////////////////////////////
    ////   Record Hail
    ////   If guild was hailed (hailstatus=1) Set:
    ////    - HailId
    ///     - Hailed - Date
    ////    - HailChatLines -- Set to Zero
    ///    cActionStatus3
    //////////////////////////////////////////////////////////////////////
    function postRecord(guildId, cardIndex, listId, textToPost){
        if (gConfig.debug) consoleLogToFile('debug postRecord START');

        var ajaxRunningCount = 0
        var ajaxRunningCount_failed = []
        var call = []

        ajaxRunningCount_guildsToTest.forEach(function (obj, index){  
            var guildId = obj.guildId
            var cardIndex = obj.cardIndex
            var listId = obj.listId
            var textToPost = obj.textToPost

            if (obj.cActionStatus == 3){                
                //Comment of Action
                if ((guildsLatestData[guildId].hailStatus == 1) || 
                    (listId == logListIdClearSailing) || 
                    (listId == logListIdTargetSpotted) || 
                    (listId == logListIdPrivateNavy) ||
                    (obj.idList == logListIdBermudaTriangle)
                ){
                    actionTakenInLoop = true
                    if (gConfig.debug) consoleLogToFile('Record-Force to get details in next loop: Action Taken. Set to Loop again for ' + guildId)
                    
                    //hailedId
                    if ((listId != logListIdClearSailing) && (listId != logListIdTargetSpotted) && (listId != logListIdDoNotHail) && (listId != logListIdPrivateNavy) && (listId != logListIdBermudaTriangle)  ){
                        var newValue = {}
                        newValue[logCustomFields['hailedId'].type] = guildsLatestData[guildId].hailData.id
                    } else {
                        var newValue = ''
                    }

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['hailedId'].id + gConfig.logServerPathCustFieldItem
                    newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postRecordHailId_Success, fnFailure: postRecord_Failure, item: item})

                    //hailed (date)
                    if  ((listId != logListIdClearSailing) && (listId != logListIdPrivateNavy)){
                        var newValue = {}
                        if (listId != logListIdTargetSpotted){
                            newValue[logCustomFields['hailed'].type] = String(moment(guildsLatestData[guildId].hailData.timestamp).utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))
                        } else {
                            newValue[logCustomFields['hailed'].type] = moment().utc().format('YYYY-MM-DD')
                        }
                    } else {
                        var newValue = ''
                    }
                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['hailed'].id + gConfig.logServerPathCustFieldItem
                    newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postRecordHailed_Success, fnFailure: postRecord_Failure, item: item})

                    //Hail Chat Lines
                    if ((listId != logListIdClearSailing) && (listId != logListIdTargetSpotted) && (listId != logListIdPrivateNavy) || (listId != logListIdBermudaTriangle)){
                        var newValue = {}
                        newValue[logCustomFields['hailedChatLines'].type] = '0'
                    } else {
                        var newValue = ''
                    }

                    ajaxRunningCount++
                    var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id + gConfig.logServerPathCustField + '/' + logCustomFields['hailedChatLines'].id + gConfig.logServerPathCustFieldItem
                    newData = {value: newValue}
                    var item = obj
                    call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postRecordHailedChatLines_Success, fnFailure: postRecord_Failure, item: item})

                }
            }
        });
        if (call.length > 0){
            makeAxiosCall(_.cloneDeep(call)) 
        } else {
            postRecord_Comp()
        }

        function postRecordHailId_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postRecordHailId_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            if (item.listId != logListIdSunk) guildsLatestData[item.guildId].cFields[logCustomFields['hailedId'].id]  = moment().utc()
                
            ajaxRunningCount--
            if (ajaxRunningCount == 0) postRecord_Comp()
        }

        function postRecordHailed_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postRecordHailed_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            var guildId = item.guildId
			var cardIndex = item.cardIndex
			var listId = item.listId
			var dueDate = item.dueDate
            
            if ((listId != logListIdClearSailing) && (listId != logListIdPrivateNavy)){
                if (listId != logListIdTargetSpotted){
                    guildsLatestData[guildId].cFields[logCustomFields['hailed'].id] = moment(guildsLatestData[guildId].hailData.timestamp).utc()
                } else {
                    guildsLatestData[guildId].cFields[logCustomFields['hailed'].id] = moment().utc().format('YYYY-MM-DD')
                }
            } else {
                guildsLatestData[guildId].cFields[logCustomFields['hailed'].id] = '' 
            }

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postRecord_Comp()
        }

        function postRecordHailedChatLines_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postRecordHailedChatLines_Success  Count:' + ajaxRunningCount + ' SUCCESS for ' + item.guildId)
      
            var guildId = item.guildId
			var cardIndex = item.cardIndex
			var listId = item.listId
			var dueDate = item.dueDate

            if ((listId != logListIdClearSailing) && (listId != logListIdTargetSpotted) && (listId != logListIdPrivateNavy))  {
                guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id] = 0
            } else {
                guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id] = ''
            }

            ajaxRunningCount--
            if (ajaxRunningCount == 0) postRecord_Comp()
        }

        function postRecord_Failure(response, item, urlTo){
            consoleLogToFile('postRecord_Failure ******** ERROR for ' + item.guildId + '   url: ' + urlTo)
            ajaxRunningCount_failed.push(item.guildId)
            ajaxRunningCount--
            if (ajaxRunningCount == 0) postRecord_Comp()
        }

        function postRecord_Comp(){
            ajaxRunningCount_guildsToTest.forEach(function (obj, index){
                if ((obj.cActionStatus == 3) && (ajaxRunningCount_failed.indexOf(obj.guildId) < 0)){
                    obj.cActionStatus = 4   
                    guildsLatestData[obj.guildId].hailStatus = 2 //Don't reset again
                } 
            }); 
            postCompleteUpdate()            
        }
        //if (gConfig.debug) consoleLogToFile('debug postRecord END ');
    }


	//////////////////////////////////////////////////////////////////////
    ////    Final update of Card
    ///     Update of Description, labels, list,  and due date
    ///     cActionStatus4
    //////////////////////////////////////////////////////////////////////
    function postCompleteUpdate(){
        if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate START');
		
		var ajaxRunningCount = 0
        var call = []

		ajaxRunningCount_guildsToTest.forEach(function (obj, index){
			var guildId = obj.guildId
			var cardIndex = obj.cardIndex
			var listId = obj.listId
			var dueDate = obj.dueDate

			var newLabelList = []
			var newLabelList_Lang = []
			var labelTest = true
			var labelTest_AllLanguages = false

			var flagRemoveActiveComment = false

			if (obj.cActionStatus == 4){
                //Description
				if (guildsLatestData[guildId].guild != undefined){
					var cardDesc =  ESCAPECHAR  + '[' + guildsLatestData[guildId].guild.name + '](' + gConfig.habiticaGuildUrl + guildId + ')\n\n' + 
									'\n---\n' +
									'# SUMMARY' +
									'\n---\n' +
									guildsLatestData[guildId].guild.summary +
									'\n\n\n---\n' +
									'# DESCRIPTION' +
									'\n---\n' +
									guildsLatestData[guildId].guild.description
					cardDesc = cardDesc.substring(0, 16382)
				} else {
					var cardDesc = cards[cardIndex].description
				}

                //labels
				cards[cardIndex].labels.forEach(function (obj, index){
					if ((guildsLatestData[guildId].guild != undefined) && (obj.id == logLabelDNHOfficial)){
						labelTest = false
						if (guildsLatestData[guildId].habiticaOfficial) newLabelList.push(logLabelDNHOfficial)
					} else if ((obj.id == logLabelCallForLastRites) && 
						(
							(listId == logListIdLastRites) ||
							(listId == logListIdClearSailing) ||
							(listId == logListIdPrivateNavy) ||
							(listId == logListIdSunk) 
						)
					){
						//do nothing so the label is removed
						if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate remove logLabelCallForLastRites for ' + guildId)
					} else if ((obj.id == logLabelCallForReHail) && 
						(
							(
								(listId != logListIdCaptainMIA) &&
								(listId != logListIdCaptured) 
							) || (
								(guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id] == 0) 
							)
						)
					){
						//do nothing so the label is removed
						if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate remove logLabelCallForReHail for ' + guildId)
					} else if (obj.id == logLabelCallForDropAnchor){
						if (
							(listId != logListIdClearSailing) &&
							(listId != logListIdPrivateNavy) &&
							(listId != logListIdSunk) 
						){
							 //Replace label & Set Due date to future
							if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate replace logLabelCallForDropAnchor to logLabelDropAnchor for ' + guildId)
							newLabelList.push(logLabelDropAnchor)
							dueDate = moment().utc().add(gConfig.dayDropAnchor, 'day').format('YYYY-MM-DDTHH:mm:ss.SSS')
							if (cards[cardIndex].idList == logListIdLastRites ){
								if (guildsBotLeader.indexOf(guildId) >= 0){
									if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate Guild ' + guildId + ' is moved from Last Rites to Captured')
									listId = logListIdCaptured
								} else {
									if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate Guild ' + guildId + ' is moved from Last Rites to CaptainMIA')
									listId = logListIdCaptainMIA
								}
							}

                        } else {
							//do nothing so the label is removed
							if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate remove logLabelCallForDropAnchor for ' + guildId + ' as it is in clear waters')
						} 
					
					} else if (obj.id == logLabelDropAnchor){
						if (
							(listId != logListIdClearSailing) &&
							(listId != logListIdPrivateNavy) &&
							(listId != logListIdSunk) &&
							!(moment().utc().add(0, 'days').isAfter(cards[cardIndex].due))
						){
							 //Keep label 
							if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate replace logLabelCallForDropAnchor to logLabelDropAnchor for ' + guildId)
							newLabelList.push(logLabelDropAnchor)
						} else {
							//do nothing so the label is removed
							if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate remove logLabelCallForDropAnchor for ' + guildId)
						} 
                    } else if (obj.id == logLabelSailToBermudaTriangle){
						if (
							(listId == logListIdClearSailing) ||
							(listId != logListIdPrivateNavy) ||
							(listId != logListIdSunk) ||
                            (listId != logListIdBermudaTriangle) 
						){
							 //Keep label 
							if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate remove logLabelSailToBermudaTriangle for ' + guildId)

						} else {
							//Keep label as not yet finished
							if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate logLabelSailToBermudaTriangle not yet complete. Keeping label for ' + guildId)
                            newLabelList.push(logLabelSailToBermudaTriangle)
						} 
					} else if (obj.id == logLabelRemoveActiveComment){
						//do nothing so the label is removed
						flagRemoveActiveComment = true

						if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate remove logLabelRemoveActiveComment for ' + guildId)
					
					} else if (obj.id == logLabelAllLanguages){
						labelTest_AllLanguages = true
						newLabelList.push(obj.id)
					} else if (obj.color == gConfig.labelColour_Language){
						newLabelList_Lang.push(obj.id)
					} else {
						if (obj.id != '') newLabelList.push(obj.id)
					} 
				})
				if ((labelTest) &&  (guildsLatestData[guildId].habiticaOfficial)) newLabelList.push(logLabelDNHOfficial)

				if (labelTest_AllLanguages){
					newLabelList_Lang = labels_allLanguages    
				}    
				
				if ((flagRemoveActiveComment) || (listId != cards[cardIndex].idList)  || (listId == logListIdSunk) ){
					newLabelList.forEach(function (obj, index){
						if (obj == logLabelAdmiralReport) newLabelList.splice(index, 1)
					});
				}

				newLabelList = _.concat(newLabelList, newLabelList_Lang)

                if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate Updating ' + guildId + ' with listId: ' + listId + '    and Labels: ' + newLabelList.toString())

				//Finally make the call.
				ajaxRunningCount++
				var urlToAction = gConfig.logServerUrl + gConfig.logServerPathCards + '/' + cards[cardIndex].id
				//leave in the same position unless been recently added to the list
				if (cards[cardIndex].idList != listId){
					var newData = {
						name: guildId,
						desc: cardDesc,
						pos: 'top',
						due: dueDate,
						dueComplete: 'false',
						idLabels: newLabelList.toString(),
						idList: listId
					} 
				} else {
					var newData = {
						name: guildId,
						desc: cardDesc,
						due: dueDate,
						dueComplete: 'false',
						idLabels: newLabelList.toString(),
						idList: listId,
						urlSource: gConfig.habiticaGuildUrl + guildId
					}             
				}
				var item = obj
				call.push({targetType: 'log', requestType: 'PUT', urlTo: urlToAction, newData: newData, fnSuccess: postCompleteUpdate_Success, fnFailure: postCompleteUpdate_Failure, item: item})
			}
		});
        if (call.length > 0){
            makeAxiosCall(_.cloneDeep(call))  
        } else {
            postCompleteUpdate_Comp()
        }

        function postCompleteUpdate_Success(data, item){
            if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate_Success Count:' + ajaxRunningCount + '  SUCCESS for ' + item.guildId)
            var guildId = item.guildId
            var cardIndex = item.cardIndex
            var listId = item.listId

            if (listId == logListIdSunk){
                if (masterList[guildId] != undefined){
                    guildsSunk.push(masterList[guildId])
                    delete masterList[guildId] //remove from json
                }
            } else {
                if (guildsLatestData[guildId].guild.summary != undefined){
                    masterList[guildId].summary = guildsLatestData[guildId].guild.summary
                } else {
                    masterList[guildId].summary = ''
                }
            }
            //dont update cFieldsStatus as there are some require to refresh the data again (found card)
            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCompleteUpdate_Comp()
        }

        function postCompleteUpdate_Failure(response, item, urlTo){
            consoleLogToFile('postCompleteUpdate_Failure ******** ERROR for: ' + item.guildId)
            //handle error
            
            actionTakenInLoop = true // we only want to repeat the loop if we failed. (all other checks past)
			if (gConfig.debug) consoleLogToFile('Failure on last update: Action Taken. Set to Loop again')
            ajaxRunningCount--
            if (ajaxRunningCount == 0) postCompleteUpdate_Comp()
        }
    }

    function postCompleteUpdate_Comp(){
        if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate_Comp START');
        if (gConfig.debug) consoleLogToFile('End Attempt')
        if (gConfig.debug) consoleLogToFile('Total Guilds Tested this Attempt:' + totalGuilds.tested['attempt' + totalGuilds.tested.fullAttempt ])
        if (gConfig.debug) consoleLogToFile('Total Guilds in all:' + totalGuilds.tested['total'])
        if (gConfig.debugConsole) console.log('End Attempt: Total Guilds Tested this Attempt:' + totalGuilds.tested['attempt' + totalGuilds.tested.fullAttempt ])

        if (actionTakenInLoop){
            fetchBaseData()
        } else {
            if (gConfig.debug) consoleLogToFile('********************************************');
            if (gConfig.debug) consoleLogToFile('********************************************');
            if (gConfig.debug) consoleLogToFile('********************************************');
            if (gConfig.debug) consoleLogToFile('All updates done. Just need to report!')
            if (gConfig.debug) consoleLogToFile('********************************************');
            if (gConfig.debug) consoleLogToFile('********************************************');
            if (gConfig.debug) consoleLogToFile('********************************************');
            //Cron and complete daily other tasks.
            reportResults()
        }
        if (gConfig.debug) consoleLogToFile('debug postCompleteUpdate_Comp END');  
    }

    if (gConfig.debug) consoleLogToFile('debug fetchAndUpdateAllData END');
}


//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
////   3rd Part:                                     /////////////////
////   Reporting Results                             /////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
function reportResults(){
    if (gConfig.debugConsole) console.log('reportResults: 3rd Part: Just a little more to do')
    if (gConfig.debug) consoleLogToFile('********************************************');
    if (gConfig.debug) consoleLogToFile('********************************************');
    if (gConfig.debug) consoleLogToFile('********************************************');    
    if (gConfig.debug) consoleLogToFile('debug reportResults START');
    if (gConfig.debug) consoleLogToFile('********************************************');
    if (gConfig.debug) consoleLogToFile('********************************************');
    if (gConfig.debug) consoleLogToFile('********************************************');

    //temp variables
    var langPrimary = []
    var lang = []
    var noEnglish = false
    var allLang = false

    var guildPrivate = []

    //set up stats and structure
    var stats = {}

    stats['overall'] = {public: {total: 0, clearSailing: 0, pirateAction: 0, droppedAnchor: 0}, private: {total: 0, privateNavy: 0, pirateAction: 0, droppedAnchor: 0} }

    stats['publicColor'] = {gold: 0, silver: 0, bronze: 0}

    stats['pirateAction'] = {public:{}, private: {}}
    stats.pirateAction.public['justLaunched'] = 0
    stats.pirateAction.public['targetSpotted'] = 0
    stats.pirateAction.public['captianMIA'] = 0
    stats.pirateAction.public['captured'] = 0
    stats.pirateAction.public['lastRites'] = 0
    stats.pirateAction.public['doNotHail'] = 0
    stats.pirateAction.public['bermudaTriangle'] = 0

    stats.pirateAction.private['justLaunched'] = 0
    stats.pirateAction.private['targetSpotted'] = 0
    stats.pirateAction.private['captianMIA'] = 0
    stats.pirateAction.private['captured'] = 0
    stats.pirateAction.private['lastRites'] = 0
    stats.pirateAction.private['doNotHail'] = 0
    stats.pirateAction.private['bermudaTriangle'] = 0
    
    stats.publicLang = {}
    stats.publicLang.lang = {}
    stats.publicLang.lang[gConfig.logLabelLanguage_English.substring(0,2)] = 0
    stats.publicLang.langPrimary = {}
    stats.publicLang.langPrimary[gConfig.logLabelLanguage_English.substring(0,2)] = 0
    stats.publicLang.langAll = 0
    stats.publicLang.langPrimaryNoEng = 0

    stats['flow'] = {}
    stats.flow['launched'] = {public: 0, private: 0}
    stats.flow['sunk'] = {public: 0, lifeLengthPublic: [], private: 0, lifeLengthPrivate: []}


    //overall public/private totals, joined,  & Colour
    guilds.forEach(function(obj, index){
        //skip the Tavern guilds
        if (gConfig.debugVerbose) consoleLogToFile('Guild: ' + obj._id) 
        if ((obj._id != gConfig.botGuildTavernAlt) && (obj._id != gConfig.botGuildTavern)){
            if (obj.privacy == 'public'){
               stats.overall.public.total++
                if (obj.memberCount < gConfig.guildColourSilver){
                    stats.publicColor.bronze++
                } else {
                    if (obj.memberCount < gConfig.guildColourGold){
                        stats.publicColor.silver++
                    } else {
                        stats.publicColor.gold++
                    }
                }
                if (guildsJoined.indexOf(obj._id) >= 0) stats.flow.launched.public++ 
            } else {
                stats.overall.private.total++ 
                guildPrivate.push(obj._id)
                if (guildsJoined.indexOf(obj._id) >= 0) stats.flow.launched.private++ 
            }
        }

        //Calculating reporting Stats
        //This is done to avoid mismatching
        //Using Every so it can break
        cards.every(obj2 => {            
            if (obj2.name == obj._id) {
                if (gConfig.debugVerbose) consoleLogToFile('Card: ' + obj2.name)            
                if (gConfig.debugVerbose) consoleLogToFile('Public guild: ' + (obj.privacy == 'public'))      
                if (gConfig.debugVerbose) consoleLogToFile('List: ' + obj2.idList) 

                switch (obj2.idList){
                    case logListIdJustLaunched: 
                        if (obj.privacy == 'public') stats.pirateAction.public.justLaunched++; else stats.pirateAction.private.justLaunched++ 
                        if (obj.privacy == 'public') stats.overall.public.pirateAction++; else stats.overall.private.pirateAction++
                        break;
                    case logListIdClearSailing:
                        if (obj.privacy == 'public') {
                            stats.overall.public.clearSailing++ 
                        } else {
                            consoleLogToFile('***** ERROR: Guild in wrong list (ClearSailing instead of Private Navy) *****' + obj.privacy) 
                            stats.overall.private.privateNavy++
                        } 
                        break;
                    case logListIdTargetSpotted: 
                        if (obj.privacy == 'public') stats.pirateAction.public.targetSpotted++; else stats.pirateAction.private.targetSpotted++ 
                        if (obj.privacy == 'public') stats.overall.public.pirateAction++; else stats.overall.private.pirateAction++
                        break;
                    case logListIdCaptainMIA: 
                        if (obj.privacy == 'public') stats.pirateAction.public.captianMIA++; else stats.pirateAction.private.captianMIA++ 
                        if (obj.privacy == 'public') stats.overall.public.pirateAction++; else stats.overall.private.pirateAction++
                        break;
                    case logListIdCaptured: 
                        if (obj.privacy == 'public') stats.pirateAction.public.captured++; else stats.pirateAction.private.captured++
                        if (obj.privacy == 'public') stats.overall.public.pirateAction++; else stats.overall.private.pirateAction++
                        break;
                    case logListIdLastRites: 
                        if (obj.privacy == 'public') stats.pirateAction.public.lastRites++; else stats.pirateAction.private.lastRites++; 
                        if (obj.privacy == 'public') stats.overall.public.pirateAction++; else stats.overall.private.pirateAction++
                        break;
                    case logListIdDoNotHail: 
                        if (obj.privacy == 'public') stats.pirateAction.public.doNotHail++; else stats.pirateAction.private.doNotHail++
                        if (obj.privacy == 'public') stats.overall.public.pirateAction++; else stats.overall.private.pirateAction++
                        break;
                    case logListIdBermudaTriangle:
                        if (obj.privacy == 'public') stats.pirateAction.public.bermudaTriangle++; else stats.pirateAction.private.bermudaTriangle++
                        if (obj.privacy == 'public') stats.overall.public.pirateAction++; else stats.overall.private.pirateAction++
                        break;
                    case logListIdPrivateNavy: 
                        if (obj.privacy == 'public'){
                            consoleLogToFile('***** ERROR: Guild in wrong list (private instead of Clear Sailing) *****' + obj.privacy) 
                            stats.overall.clearSailing++
                        } else {
                            stats.overall.private.privateNavy++
                        }
                        break;
                    default:
                        consoleLogToFile('***** ERROR: Unknown Guild Classification *****' + obj.privacy)
                        //do nothing as (Config Card)
                }
 
                //Language and Dropped Shipped stats 
                langPrimary = []
                lang = []
                noEnglish = false
                allLang = false
                obj2.labels.forEach(function (obj3, index2){
                    if (gConfig.debugVerbose) consoleLogToFile(obj3.name) 

                    if (obj.privacy == 'public'){                 
                        if (obj3.name == gConfig.logLabelDropAnchorName) stats.overall.public.droppedAnchor++
                        
                        if (
                            (obj2.idList == logListIdClearSailing) || 
                            (obj2.idList == logListIdTargetSpotted) || 
                            (obj2.idList == logListIdCaptainMIA) || 
                            (obj2.idList == logListIdCaptured) || 
                            (obj2.idList == logListIdLastRites) || 
                            (obj2.idList == logListIdDoNotHail) ||
                            (obj2.idList == logListIdBermudaTriangle)
                        ){
                            if (obj3.name == gConfig.logLabelAllLanguagesName){
                                stats.publicLang.langAll++
                                allLang = true
                            }
                            if (obj3.name == gConfig.logLabelNonEnglishHailName){
                                stats.publicLang.langPrimaryNoEng++
                                noEnglish = true
                            }
                            if (obj3.color == gConfig.labelColour_Language){
                                langPrimary.push(obj3.name.substring(0,2))
                                if (lang.indexOf(obj3.name.substring(0,2) < 0)) lang.push(obj3.name.substring(0,2))
                            }
                            if (obj3.color == gConfig.labelColour_LanguageSecondary)  if (lang.indexOf(obj3.name.substring(0,2) < 0)) lang.push(obj3.name.substring(0,2))
                        } 
                    } else {
                        if (obj3.name == gConfig.logLabelDropAnchorName) stats.overall.private.droppedAnchor++
                    }
                });

                if  ((obj.privacy == 'public') && 
                    (
                        (obj2.idList == logListIdClearSailing) || 
                        (obj2.idList == logListIdTargetSpotted) || 
                        (obj2.idList == logListIdCaptainMIA) || 
                        (obj2.idList == logListIdCaptured) || 
                        (obj2.idList == logListIdLastRites) || 
                        (obj2.idList == logListIdDoNotHail) ||
                        (obj2.idList == logListIdBermudaTriangle)
                    )
                ){
                    if (noEnglish == false){
                        langPrimary.push(gConfig.logLabelLanguage_English.substring(0,2))
                        if (lang.indexOf(gConfig.logLabelLanguage_English.substring(0,2) < 0)) lang.push(gConfig.logLabelLanguage_English.substring(0,2))
                    }
                    
                    if (gConfig.debugVerbose) consoleLogToFile('langPrimary: ' + langPrimary.length + '    lang: ' + lang.length)
                    

                    if (langPrimary.length > 0){
                        langPrimary.forEach(function (obj3, index2){
                            if (stats.publicLang.langPrimary[obj3] == undefined) stats.publicLang.langPrimary[obj3] = 0
                            stats.publicLang.langPrimary[obj3]++
                        });
                        lang.forEach(function (obj3, index2){
                            if (stats.publicLang.lang[obj3] == undefined) stats.publicLang.lang[obj3] = 0
                            stats.publicLang.lang[obj3]++
                        });
                    } else {
                        if (gConfig.debugVerbose) consoleLogToFile('ERROR: No langagues assigned for: ' + obj2.name)  
                    }
                }

                // Stop seraching
                return false;
            }

            return true;
        })
    });

   
    //sunk guilds this session
    guildsSunk.forEach(function(obj, index){
        var result  = 0

        if (moment(obj.created).isSameOrBefore(gConfig.masterDateRoundUp)) obj.created = gConfig.masterDateRoundUp 
        result = moment().utc().diff(obj.created, 'days') 
        
        if (obj.privacy != 'public'){
            stats.flow.sunk.private++
            stats.flow.sunk.lifeLengthPrivate.push(result)
        } else {
            stats.flow.sunk.public++
            stats.flow.sunk.lifeLengthPublic.push(result)
        }
    });

    exportStats()
    exportMasterList()
    exportGUS()
    exportPirateAction()


    if ((testOnlyThisGuild == '') && (gConfig.rptElvenExport == true)) exportElvenReport() //takes too long so need to check
    
    if (testOnlyThisGuild == '')  createCoveReport()

    //go update my cron stats
    if (testOnlyThisGuild == ''){
        postScoreTask(gConfig.botTaskIdRunAll) 
    } else {
        postScoreTask(gConfig.botTaskIdRunSingle)
    }
    if (testOnlyThisGuild == '') postCron()

    


	//////////////////////////////////////////////////////////////////////
    ////    Stats export.
    ///     All data for external reference
    //////////////////////////////////////////////////////////////////////
    function exportStats(){
        if (gConfig.debug) consoleLogToFile('debug exportStats START');

        var fileContents = fs.readFileSync(gConfig.journalStats, 'utf-8');
        var tempBox = JSON.parse(fileContents)

        //If already created add previous flow calcs together
        if (tempBox[moment().utc().format('YYYY-MM-DD')] != undefined){
            stats.flow.launched.public += tempBox[moment().utc().format('YYYY-MM-DD')].flow.launched.public
            stats.flow.sunk.public += tempBox[moment().utc().format('YYYY-MM-DD')].flow.sunk.public
            stats.flow.sunk.lifeLengthPublic = stats.flow.sunk.lifeLengthPublic.concat(tempBox[moment().utc().format('YYYY-MM-DD')].flow.sunk.lifeLengthPublic)
        } else {
            tempBox = Object.assign({[moment().utc().format('YYYY-MM-DD')]: {}}, tempBox); //make sure new item is first when exported.
        }

        tempBox[moment().utc().format('YYYY-MM-DD')] = stats

        var output = JSON.stringify(tempBox, null, 2);  
        fs.writeFileSync(gConfig.journalStats, output);  

        if (gConfig.debug) consoleLogToFile('debug exportStats END');
    }  

	//////////////////////////////////////////////////////////////////////
    ////    Master export.
    ///     All data for external reference
    //////////////////////////////////////////////////////////////////////
    function exportMasterList(){
        if (gConfig.debug) consoleLogToFile('debug exportMasterList START');

        var tempBox = {}
        tempBox['lastupdated'] = moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSS')
        tempBox['guild'] = masterList
        var output = JSON.stringify(tempBox, null, 2);  
        fs.writeFileSync(gConfig.journalMaster, output);  

        if (gConfig.debug) consoleLogToFile('debug exportMasterList END');
    }   

	//////////////////////////////////////////////////////////////////////
    ////    Create GUS export.
    ///     Only guilds in Clear Sailing to be listed
    //////////////////////////////////////////////////////////////////////
    function exportGUS(){
        if (gConfig.debug) consoleLogToFile('debug exportGUS START');

        var reportGus = {}
        reportGus['lastupdated'] = moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSS')
        reportGus['totals'] = {}
        reportGus.totals['public'] = stats.overall.public.total
        reportGus.totals['clearSailing'] = stats.overall.public.clearSailing
        reportGus.totals['sizeBreakdown'] =  stats.publicColor
        reportGus.totals['publicLang'] =  stats.publicLang
        reportGus['guild'] = {}
        

        cards.forEach(function(obj, index){
            if (obj.idList == logListIdClearSailing){
                var langPrimary = []
                var lang = []
                var langAll = false
                var group = ''
                var groupname = [] 
                var official = false
                var noEnglish = false
                var element = {}
                var summaryClean = ''
                var memberColor = ''

                obj.labels.forEach(function(obj2, index2){
                    switch(obj2.color){
                    case gConfig.labelColour_Language:
                        langPrimary.push(obj2.name.substring(0,2))
                        if (lang.indexOf(obj2.name.substring(0,2)) < 0 ) lang.push(obj2.name.substring(0,2))
                        break;
                    case gConfig.labelColour_LanguageSecondary:
                        if (lang.indexOf(obj2.name.substring(0,2)) < 0 ) lang.push(obj2.name.substring(0,2))
                        break;
                    case gConfig.labelColour_Category:
                        group = obj2.name
                        break;
                    case gConfig.labelColour_DNH:
                        if (obj2.name == gConfig.logLabelDNHOfficialName) official = true
                        if (obj2.name == gConfig.logLabelNonEnglishHailName) noEnglish = true
                        break;                                            
                    default:
                        if (obj2.name == gConfig.logLabelAllLanguagesName) langAll = true
                    }
                })


                //Only add if there is a category
                if (group != ''){
                    groupname[0] = gConfigCatLabelTranslate[group].cat
                    groupname[1] = gConfigCatLabelTranslate[group].sub

                    //finalise langauges
                    if (noEnglish == false){
                        langPrimary.push(gConfig.logLabelLanguage_English.substring(0,2))
                        if (lang.indexOf(gConfig.logLabelLanguage_English.substring(0,2))) lang.push(gConfig.logLabelLanguage_English.substring(0,2))
                    }
                    summaryClean = removeFormating(masterList[obj.name].summary)

                    if (masterList[obj.name].memberCount < gConfig.guildColourSilver){
                        memberColor = 'bronze'
                    } else {
                        if (masterList[obj.name].memberCount < gConfig.guildColourGold){
                            memberColor = 'silver'
                        } else {
                            memberColor = 'gold'
                        }
                    }

                    if (groupname[1] != undefined){
                        element = {
                            'id': obj.name, 
                            'url': gConfig.habiticaGuildUrl + obj.name,
                            'title': masterList[obj.name].name,
                            'summary': summaryClean,
                            'memberCount': masterList[obj.name].memberCount,
                            'memberColor': memberColor,
                            'official': official,
                            'lang': lang,
                            'langPrimary': langPrimary,
                            'langAll' : langAll,
                            'category': groupname[0],
                            'subcategory': groupname[1],
                            'created': masterList[obj.name].created
                        }


                        reportGus.guild[obj.name] = _.clone(element, true)
                    } else {
                        if (group != ''){
                            consoleLogToFile(' ******** ERROR - Missing entry in configCatLabelTranslate ********')
                            if (debugConsole) console.log(' ******** ERROR - Missing entry in configCatLabelTranslate ********')
                        }
                    }
                }
            }
        })

        var output = JSON.stringify(reportGus, null, 2);  
        fs.writeFileSync(gConfig.journalGus, output);  

        if (gConfig.debug) consoleLogToFile('debug exportGUS END');
    }   

    //////////////////////////////////////////////////////////////////////
    ////    Pirate Action report.
    ///     Pirate Date for external reference
    //////////////////////////////////////////////////////////////////////
    function exportPirateAction(){
        if (gConfig.debug) consoleLogToFile('debug exportPirateAction START');

        //if (Object.keys(guildsLatestData).length >= (stats.overall.public.pirateAction - stats.pirateAction.public.bermuda)){
            var tempBox = {}

            tempBox['lastupdated'] = moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSS')
            tempBox['stats'] = stats.pirateAction
            tempBox.stats.droppedAnchor = {}
            tempBox.stats.droppedAnchor.public = stats.overall.public.droppedAnchor
            tempBox.stats.droppedAnchor.private = stats.overall.private.droppedAnchor
            tempBox.stats.total = {}
            tempBox.stats.total.public = stats.overall.public.pirateAction
            tempBox.stats.total.private = stats.overall.private.pirateAction

            tempBox.guilds = {justLaunched: [], targetSpotted: [], captianMIA: [], captured: [], lastRites: [], doNotHail: [], bermudaTriangle:[], droppedAnchor: []}


            //Compiling the values used in reports
            cards.forEach(function(obj, index){
                var droppedAnchor = false
                var nameToShow = gConfigText.msgPrivateGuildNotStated

                //Do not include private stats or Sunk Ships
                if (
                    (obj.idList == logListIdJustLaunched) || 
                    (obj.idList == logListIdTargetSpotted) || 
                    (obj.idList == logListIdCaptainMIA) || 
                    (obj.idList == logListIdCaptured) || 
                    (obj.idList == logListIdLastRites) || 
                    (obj.idList == logListIdDoNotHail) ||
                    (obj.idList == logListIdBermudaTriangle)
                ){
                    if (masterList[obj.name] != undefined)  if (masterList[obj.name].name != undefined) {
                        nameToShow = masterList[obj.name].name
                    }
  
                    if ((masterList[obj.name] != undefined) && (masterList[obj.name].privacy == 'public')){

                        if (guildsLatestData[obj.name] == undefined ){
                            //Do Nothing as not needed
                        } else if (guildsLatestData[obj.name].cFields == undefined){
                                consoleLogToFile ('ERROR ! cFIELDS is missing for ' + obj.name)
                                guildsLatestData[obj.name].cFields = {} 
                        }
                        
                        obj.labels.forEach(function (obj2, index2){
                            if (obj2.id == logLabelDropAnchor) droppedAnchor = true
                        });

                        if (droppedAnchor){
                            if (guildsLatestData[obj.name] != undefined ){ 
                            tempBox.guilds.droppedAnchor.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: guildsLatestData[obj.name].cFields[logCustomFields['actionStarted'].id], raiseAnchor: obj.due} )
                            } else {
                                tempBox.guilds.droppedAnchor.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: '', raiseAnchor: obj.due })
                            }
                            
                        } else {

                            switch (obj.idList){
                                case logListIdJustLaunched: 
                                    if (guildsLatestData[obj.name] != undefined ){
                                        tempBox.guilds.justLaunched.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: guildsLatestData[obj.name].cFields[logCustomFields['guildCreated'].id] })
                                    } else {
                                        tempBox.guilds.justLaunched.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: '' })
                                    }
                                    break;
                                case logListIdTargetSpotted: 
                                    if (guildsLatestData[obj.name] != undefined ){
                                        tempBox.guilds.targetSpotted.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: guildsLatestData[obj.name].cFields[logCustomFields['hailed'].id] } )
                                    } else {
                                        tempBox.guilds.targetSpotted.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: '' })
                                    } 
                                    break;
                                case logListIdCaptainMIA: 
                                    if (guildsLatestData[obj.name] != undefined ){
                                        tempBox.guilds.captianMIA.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: guildsLatestData[obj.name].cFields[logCustomFields['actionStarted'].id], hailed: guildsLatestData[obj.name].cFields[logCustomFields['hailed'].id] })
                                    } else {
                                        tempBox.guilds.captianMIA.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: '', hailed: '' })
                                    }
                                    break;
                                case logListIdCaptured: 
                                    if (guildsLatestData[obj.name] != undefined ){
                                        tempBox.guilds.captured.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: guildsLatestData[obj.name].cFields[logCustomFields['actionStarted'].id], hailed: guildsLatestData[obj.name].cFields[logCustomFields['hailed'].id] })
                                    } else {
                                        tempBox.guilds.captured.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: '', hailed: '' })
                                    }
                                    break;
                                case logListIdLastRites: 
                                    if (guildsLatestData[obj.name] != undefined ){
                                        tempBox.guilds.lastRites.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: guildsLatestData[obj.name].cFields[logCustomFields['actionStarted'].id], hailed: guildsLatestData[obj.name].cFields[logCustomFields['hailed'].id] })
                                    } else {
                                        tempBox.guilds.lastRites.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: '', hailed: '' })
                                    }
                                    break;
                                case logListIdDoNotHail: 
                                    if (guildsLatestData[obj.name] != undefined ){
                                        tempBox.guilds.doNotHail.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: guildsLatestData[obj.name].cFields[logCustomFields['actionStarted'].id] })
                                    } else {
                                        tempBox.guilds.doNotHail.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: '' })
                                    }
                                    break;
                                case logListIdBermudaTriangle: 
                                        tempBox.guilds.droppedAnchor.push( {id: obj.name, name: nameToShow, url: gConfig.habiticaGuildUrl + obj.name, actionStarted: '', return: obj.due })
                                    break;
                                default:
                                    //do nothing as Config, Clear Sailing, Private Army
                            }
                        }//test if private
                    }
                } 
            });

            var output = JSON.stringify(tempBox, null, 2);  
            fs.writeFileSync(gConfig.journalPirate, output);  
  /*      } else {
            consoleLogToFile('debug exportPirateAction unable to export as not enough data.')
            consoleLogToFile('debug exportPirateAction pirateAction: ' +  stats.overall.public.pirateAction)
            consoleLogToFile('debug exportPirateAction Data collected (guildsLatestData): ' + Object.keys(guildsLatestData).length) 
        }
*/
        if (gConfig.debug) consoleLogToFile('debug exportPirateAction END');
    }


	//////////////////////////////////////////////////////////////////////
    ////    Elven Report export.
    ///     All data for external reference 
    ///     (Only public guilds - No Usernames )
    //////////////////////////////////////////////////////////////////////
    function exportElvenReport(){
        if (gConfig.debug) consoleLogToFile('debug exportElvenReport START');

        var datafetched = []
        var tempBox = {}
        var pageFetchChallenge = 0
        tempBox['lastupdated'] = moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSS')
        tempBox.challenges = []

        fetchChallengeDataAll()

        function fetchChallengeDataAll(){
            if (gConfig.debug) consoleLogToFile('debug fetchChallengeDataAll START');

            var call = []
            var urlToAction = gConfig.botServerUrl + gConfig.botServerPathChallengeUser + pageFetchChallenge
            var newData = {}
            var item = {}
            call.push({targetType: 'bot', requestType: 'GET', urlTo: urlToAction, newData: newData, fnSuccess: fetchChallengeDataAll_Success, fnFailure: fetchChallengeDataAll_Failure, item: item})					
            makeAxiosCall(_.cloneDeep(call))

            function fetchChallengeDataAll_Success(data, item){
                if (gConfig.debug) consoleLogToFile('debug fetchChallengeDataAll_Success SUCCESS Fetch ' + pageFetchChallenge)

                var ephemeralBox = data
                datafetched = datafetched.concat(ephemeralBox)
                if (ephemeralBox.length < 10){
                    formatAndExportChallengeDataAll()
                } else {
                    pageFetchChallenge++
                    fetchChallengeDataAll()
                }
            }

            function fetchChallengeDataAll_Failure(response, item, urlTo){
                consoleLogToFile('debug fetchChallengeDataAll_Failure ******** ERROR for ' + urlTo)
                consoleLogToFile('debug fetch page at ' + pageFetchChallenge)

                if (datafetched.length < 1){         
                    consoleLogToFile('***********************************************************')
                    consoleLogToFile('***********************************************************')
                    consoleLogToFile('        UNABLE TO COMPLETE. SEE ERROR ABOVE')
                    consoleLogToFile('***********************************************************')
                    consoleLogToFile('***********************************************************')
                } else {
                    //expoprt what you have assume went 1 page too far
                    formatAndExportChallengeDataAll()
                }
            }   

            if (gConfig.debug) consoleLogToFile('debug fetchChallengeDataAll END');
        } //fetchChallengeDataAll

        function formatAndExportChallengeDataAll(){
            if (gConfig.debug) consoleLogToFile('debug formatAndExportChallengeDataAll START');


            //format data
            datafetched.forEach(function(obj, index){
                if (obj.group.privacy == 'public'){
                    var tv = {}
                    tv.id = obj.id
                    tv.name = obj.name
                    tv.summary = removeFormating(obj.summary)
                    tv.description = obj.description
                    tv.prize =  obj.prize
                    tv.official = obj.official
                    tv.memberCount = obj.memberCount
                    tv.group = {}
                    tv.group.id = obj.group._id
                    if (obj.group.name == 'Tavern'){
                        tv.group.name = 'Public (Tavern)'
                    } else {
                        tv.group.name = obj.group.name
                    }
                    tv.created = obj.createdAt
                    tv.updated = obj.updatedAt
                    if (obj.leader != undefined){
                        tv.noOwner = false
                    } else {
                        tv.noOwner = true
                    }

                    tv.taskCount = {total: 0, habit: 0, daily: 0, todo: 0, reward: 0}

                    if (obj.tasksOrder.habits != undefined){
                        tv.taskCount.habit = obj.tasksOrder.habits.length
                        tv.taskCount.total += obj.tasksOrder.habits.length
                    }                    
                    if (obj.tasksOrder.dailies != undefined){
                        tv.taskCount.daily = obj.tasksOrder.dailies.length
                        tv.taskCount.total += obj.tasksOrder.dailies.length
                    } 
                    if (obj.tasksOrder.todos != undefined){
                        tv.taskCount.todo = obj.tasksOrder.todos.length
                        tv.taskCount.total += obj.tasksOrder.todos.length
                    } 
                    if (obj.tasksOrder.rewards != undefined){
                        tv.taskCount.reward = obj.tasksOrder.rewards.length
                        tv.taskCount.total += obj.tasksOrder.rewards.length
                    }     
                                        
                    tempBox.challenges.push(tv)
                }
            });


            var output = JSON.stringify(tempBox, null, 2);  
            fs.writeFileSync(gConfig.journalElf, output);  

            if (gConfig.debug) consoleLogToFile('debug formatAndExportChallengeDataAll END');
            if (gConfig.debugConsole) console.log('*** Elf is done ***')
        } //formatAndExportChallengeDataAll

        if (gConfig.debug) consoleLogToFile('debug exportElvenReport END');
    }


	//////////////////////////////////////////////////////////////////////
    ////    Create report to post to guild.
    ///     First determine what to report and then create report
    //////////////////////////////////////////////////////////////////////
    function createCoveReport(){
        if (gConfig.debug) consoleLogToFile('debug createCoveReport START');

        var reportJustLaunched = []
        var reportTargetSpotted = []
        var reportCaptainMIA = [] //only guilds where there is activity
        var reportCaptured = [] // only guilds where there is activiy
        var reportLastRitesActivity = [] //only guilds where there is activity
        var reportLastRitesSunk = [] //only guilds where there is activity
        var reportDoNotHailed = []

        var reportJustLaunched_admiral = []
        var reportTargetSpotted_admiral = []
        var reportCaptainMIA_admiral = [] //only guilds where there is activity
        var reportCaptured_admiral = [] // only guilds where there is activiy
        var reportLastRites_admiral = [] //only guilds where there is activity
        var reportDoNotHailed_admiral = []

        var reportClearSailing_admiral = []
        var reportPrivateNavy_admiral = []
        var reportBermudaTriangle_admiral = []
        var reportEnableChallenges = []
        
        var flagDropAnchor
        var flagActiveComment

        var strToAdd = ''
        var indexFR = 0
        var indexFR_firstStart = true //So does not break on first section
        var theFullReport = ['']
        var keyToSortBy = ''
        var keyToSortBy2 = ''


        createCoveReport_warningRocks()



        //////////////////////////////////////////////////////////////////////
        ////    Warning report of Rocks to manuver
        //////////////////////////////////////////////////////////////////////
        function createCoveReport_warningRocks(){
            if (gConfig.debug) consoleLogToFile('debug createCoveReport_warningRocks START');

            //////////////////////////////////////////////////////////////////////
            ////    Create Report
            ///     Text to be stated during report
            //////////////////////////////////////////////////////////////////////
            if ((reportWarningFastMoving.length > 0) || (reportWarningAlmostInTheOcean.length > 0) || (reportWarningReHail.length > 0) || (reportWarningNoRoster.length > 0) || (reportWarningOverRoster.length > 0) ){

                theFullReport[indexFR] += gConfigText.msgIntroWarning
                
                /////////////////////////////////////////////////////////
                ////   Warning Almost In the Ocean 
                ////////////////////////////////////////////////////////
                if (reportWarningAlmostInTheOcean.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Warning Almost In the Ocean', 'Break')
                    addToFullReport(gConfigText.msgWarningAlmostInTheOcean, 'Warning Almost In the Ocean', 'Start')

                    reportWarningAlmostInTheOcean.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['hailed', 'hailedChatLines', 'chatLast', 'actionStarted', 'private', 'labelNonEnglish'] )
                        
                        addToFullReport(strToAdd, 'Warning Almost In the Ocean', 'Line')
                    });
                }

                /////////////////////////////////////////////////////////
                ////   Warning Fast Moving 
                ////////////////////////////////////////////////////////
                if (reportWarningFastMoving.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Warning Fast Moving', 'Break')
                    addToFullReport(gConfigText.msgWarningFastMoving, 'Warning Fast Moving', 'Start')

                    reportWarningFastMoving.forEach(function(obj, index){
                        
                        strToAdd = createCoveReport_stringCreation(obj, ['hailed', 'hailedChatLines', 'chatLast', 'actionStarted', 'private', 'labelNonEnglish'] )                        
                        
                        addToFullReport(strToAdd, 'Warning Fast Moving', 'Line')
                    });
                }

                /////////////////////////////////////////////////////////
                ////   Warning ReHail 
                ////////////////////////////////////////////////////////
                if (reportWarningReHail.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Warning ReHail', 'Break')
                    addToFullReport(gConfigText.msgWarningReHail, 'Warning ReHail', 'Start')

                    reportWarningReHail.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['hailed', 'hailedChatLines', 'chatLast', 'actionStarted', 'private', 'labelNonEnglish'] )   
                        
                        addToFullReport(strToAdd, 'Warning ReHail', 'Line')
                    });
                }

                /////////////////////////////////////////////////////////
                ////   Warning Not On Roster 
                ////////////////////////////////////////////////////////
                if (reportWarningNoRoster.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Warning Not On Roster', 'Break')
                    addToFullReport(gConfigText.msgWarningNoRoster, 'Warning Not On Roster', 'Start')

                    reportWarningNoRoster.forEach(function(obj, index){                    
                        strToAdd = createCoveReport_stringCreation(obj, ['chatlines', 'memberCount', 'labelAll', 'private',  'summary'] )   
                        
                        addToFullReport(strToAdd, 'Warning Not On Roster', 'Line')
                    });
                }

                /////////////////////////////////////////////////////////
                ////   Over Roster 
                ////////////////////////////////////////////////////////
                if (reportWarningOverRoster.length > 0){                   
                    addToFullReport(gConfigText.msgSectionBreak, 'Warning Over Roster', 'Break')
                    addToFullReport(gConfigText.msgWarningOverRoster, 'Warning Over Roster', 'Start')

                    reportWarningOverRoster.forEach(function(obj, index){                    

                        strToAdd = createCoveReport_stringCreation(obj, ['chatlines', 'memberCount', 'labelAll', 'private',  'summary'] )   
                        
                        addToFullReport(strToAdd, 'Warning Over Roster', 'Line')
                    });
                }
            }

            if (gConfig.debug) consoleLogToFile('Full Report Not Blank? ' + (theFullReport[0] != ''))
            if (gConfig.debug) consoleLogToFile('Day of the week: ' + moment.utc().format('E'))
            if (moment.utc().format('E') == gConfig.weekdayReport){
                if (theFullReport[0] != ''){
                    theFullReport.push('')
                    indexFR++
                    indexFR_firstStart = true //Restarting post
                }
                createCoveReport_weeklyActivity()
            } else {
                if (theFullReport[0] != '') createCoveReport_organizeThePaperwork()
            }
        
            if (gConfig.debug) consoleLogToFile('debug createCoveReport_warningRocks END');  
        }


        //////////////////////////////////////////////////////////////////////
        ////    Weekly Activity Report
        ///     First determine what to report and then create report
        //////////////////////////////////////////////////////////////////////
        function createCoveReport_weeklyActivity(){
            if (gConfig.debug) consoleLogToFile('debug createCoveReport_weeklyActivity START');

            cards.forEach(function(obj, index){
                guildId = obj.name
                if (gConfig.debug) consoleLogToFile(guildId)

                if ((guildsLatestData[guildId] != undefined) && (guildsLatestData[guildId].cFields != undefined )){

                    flagActiveComment = (guildsHasAdmiralReportLabel.indexOf(guildId) >= 0)
                    flagDropAnchor = false
                    obj.labels.forEach(function (obj2, index2){
                        if ((obj2.id == logLabelDropAnchor) || (obj2.id == logLabelCallForDropAnchor)) flagDropAnchor = true
                   });

                    if (flagDropAnchor){
                        if (gConfig.debug) consoleLogToFile('Do not report. Drop Anchor for ' + guildId  )
                    } else {

                        //test for active comments
                        if (gConfig.debug) consoleLogToFile('Active Comment: ' + flagActiveComment)                  
                        switch(obj.idList){
                        case logListIdJustLaunched:
                            if (flagActiveComment){
                                reportJustLaunched_admiral.push(guildId)
                            } else {
                                reportJustLaunched.push(guildId)
                            }
                            break;

                        case logListIdTargetSpotted:
                            if (flagActiveComment){
                                reportTargetSpotted_admiral.push(guildId)
                            } else {
                                reportTargetSpotted.push(guildId)
                            }

                            if (guildsLatestData[guildId].cFields[logCustomFields['challengesLeaderOnly'].id] == true) reportEnableChallenges.push(guildId)
                            break;

                        case logListIdCaptainMIA:
                            if (flagActiveComment){
                                reportCaptainMIA_admiral.push(guildId)
                            } else {
                                if (guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id] > 0) reportCaptainMIA.push(guildId)  
                            } 
                            
                            if (guildsLatestData[guildId].cFields[logCustomFields['challengesLeaderOnly'].id] == true) reportEnableChallenges.push(guildId)
                            break;

                        case logListIdCaptured:
                            if (flagActiveComment){
                                reportCaptured_admiral.push(guildId)
                            } else {
                                if (guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id] > 0) reportCaptured.push(guildId)
                            }

                            if (guildsLatestData[guildId].cFields[logCustomFields['challengesLeaderOnly'].id] == true) reportEnableChallenges.push(guildId)
                            break;

                        case logListIdLastRites:
                            if (flagActiveComment){
                                reportLastRites_admiral.push(guildId)
                            } else {
                                if (guildsLatestData[guildId].cFields[logCustomFields['chatLines'].id] == 1){
                                    reportLastRitesSunk.push(guildId) //No Chat Lines sink immediately (the 1 is from the hail)
                                } else {
                                    if (guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id] != 0){
                                        //include negative in case hail push off (No ReHail)
                                        reportLastRitesActivity.push(guildId) 
                                    } else if ((guildsLatestData[guildId].cFields[logCustomFields['hailedChatLines'].id] == 0) && (moment().utc().add(gConfig.dayETNoResponse_LastRites*-1,'days').isAfter(guildsLatestData[guildId].cFields[logCustomFields['hailed'].id]))){
                                        reportLastRitesSunk.push(guildId)
                                    }
                                }
                            }
                            break;
                        
                        case logListIdDoNotHail:
                            if (flagActiveComment){
                                reportDoNotHailed_admiral.push(guildId)
                            } else {
                                reportDoNotHailed.push(guildId)
                            }
                            break;
                        
                        case logListIdClearSailing:
                            if (flagActiveComment){
                                reportClearSailing_admiral.push(guildId)
                            }
                            break;

                        case logListIdPrivateNavy:
                            if (flagActiveComment){
                                reportPrivateNavy_admiral.push(guildId)
                            }
                            break;

                        case logListIdBermudaTriangle:
                            if (flagActiveComment){
                                reportBermudaTriangle_admiral.push(guildId)
                            }
                            break;

                        default:
                            // do nothing                
                        }
                    } 
                } else {
                    if (gConfig.debug) consoleLogToFile('No data for ' + guildId + ' Sunk: ' + (obj.idList == logListIdSunk) + ' Clear Sailing: ' + (obj.idList == logListIdClearSailing) + ' Private Navy: ' + (obj.idList == logListIdPrivateNavy) + '  Bermuda Triange: ' + (obj.idList == logListIdBermudaTriangle))
                }
            });        

            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportJustLaunched: ' + reportJustLaunched.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportTargetSpotted: ' + reportTargetSpotted.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportCaptainMIA: ' + reportCaptainMIA.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportCaptured: ' + reportCaptured.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportLastRitesActivity: ' + reportLastRitesActivity.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportLastRitesSunk: ' + reportLastRitesSunk.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportDoNotHailed: ' + reportDoNotHailed.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportEnableChallenges: ' + reportEnableChallenges.length) 
            
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportJustLaunched_admiral: ' + reportJustLaunched_admiral.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportTargetSpotted_admiral: ' + reportTargetSpotted_admiral.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportCaptainMIA_admiral: ' + reportCaptainMIA_admiral.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportCaptured_admiral: ' + reportCaptured_admiral.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportLastRites_admiral: ' + reportLastRites_admiral.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportDoNotHailed_admiral: ' + reportDoNotHailed_admiral.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportClearSailing_admiral: ' + reportClearSailing_admiral.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportPrivateNavy_admiral: ' + reportPrivateNavy_admiral.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportBermudaTriangle_admiral: ' + reportBermudaTriangle_admiral.length)

            //sort arrays appropriately
            keyToSortBy = logCustomFields['guildCreated'].id
            reportJustLaunched = _.sortBy(reportJustLaunched, ['cFields.' + keyToSortBy] )
            reportJustLaunched_admiral = _.sortBy(reportJustLaunched_admiral, ['cFields.' + keyToSortBy] )
            
            keyToSortBy  = logCustomFields['hailed'].id
            keyToSortBy2  = logCustomFields['guildName'].id  
            reportTargetSpotted = _.sortBy(reportTargetSpotted, ['cFields.' + keyToSortBy, reportTargetSpotted, 'cFields.' + keyToSortBy2] )
            reportLastRitesSunk = _.sortBy(reportLastRitesSunk, ['cFields.' + keyToSortBy, reportTargetSpotted, 'cFields.' + keyToSortBy2] )

            reportTargetSpotted_admiral = _.sortBy(reportTargetSpotted_admiral, ['cFields.' + keyToSortBy, reportTargetSpotted, 'cFields.' + keyToSortBy2] )
            reportCaptainMIA_admiral = _.sortBy(reportCaptainMIA_admiral, ['cFields.' + keyToSortBy, reportTargetSpotted, 'cFields.' + keyToSortBy2] )
            reportCaptured_admiral = _.sortBy(reportCaptured_admiral, ['cFields.' + keyToSortBy, reportTargetSpotted, 'cFields.' + keyToSortBy2] )
            reportDoNotHailed_admiral = _.sortBy(reportDoNotHailed_admiral, ['cFields.' + keyToSortBy, reportTargetSpotted, 'cFields.' + keyToSortBy2] )
            reportLastRites_admiral = _.sortBy(reportLastRites_admiral, ['cFields.' + keyToSortBy, reportTargetSpotted, 'cFields.' + keyToSortBy2] )


            keyToSortBy  = logCustomFields['hailedChatLines'].id      
            keyToSortBy2  = logCustomFields['chatLast'].id  
            reportCaptainMIA = _.sortBy(reportCaptainMIA, [byKeyInt('cFields.' + keyToSortBy), 'cFields.' + keyToSortBy2 ]).reverse()
            reportCaptured = _.sortBy(reportCaptured , [byKeyInt('cFields.' + keyToSortBy), 'cFields.' + keyToSortBy2 ]).reverse()
            reportLastRitesActivity = _.sortBy(reportLastRitesActivity, [byKeyInt('cFields.' + keyToSortBy), 'cFields.' + keyToSortBy2 ]).reverse()

            reportDoNotHailed = _.sortBy(reportDoNotHailed, ['labels[0].name', 'labels[1].name'])

            reportEnableChallenges = _.sortBy(reportEnableChallenges, ['guild.name'])


            if (gConfig.debug) consoleLogToFile('debug createCoveReport AFTER SORT')
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportJustLaunched: ' + reportJustLaunched.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportTargetSpotted: ' + reportTargetSpotted.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportCaptainMIA: ' + reportCaptainMIA.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportCaptured: ' + reportCaptured.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportLastRitesActivity: ' + reportLastRitesActivity.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportLastRitesSunk: ' + reportLastRitesSunk.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportDoNotHailed: ' + reportDoNotHailed.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportEnableChallenges: ' + reportEnableChallenges.length) 
            
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportJustLaunched_admiral: ' + reportJustLaunched_admiral.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportTargetSpotted_admiral: ' + reportTargetSpotted_admiral.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportCaptainMIA_admiral: ' + reportCaptainMIA_admiral.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportCaptured_admiral: ' + reportCaptured_admiral.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportLastRites_admiral: ' + reportLastRites_admiral.length)
            if (gConfig.debug) consoleLogToFile('debug createCoveReport reportDoNotHailed_admiral: ' + reportDoNotHailed_admiral.length)


            //////////////////////////////////////////////////////////////////////
            ////    Create Report
            ///     Text to be stated during report
            //////////////////////////////////////////////////////////////////////
            if ((reportJustLaunched.length > 0) || (reportTargetSpotted.length > 0) || (reportCaptainMIA.length > 0) || (reportCaptured.length > 0) || (reportLastRitesActivity.length > 0) || (reportLastRitesSunk.length > 0) || (reportDoNotHailed.length > 0) || (reportEnableChallenges.length > 0) ){

                theFullReport[indexFR] += gConfigText.msgIntro
                
                
                /////////////////////////////////////////////////////////
                ////   Pirate Report Captain MIA
                ////////////////////////////////////////////////////////
                if (reportCaptainMIA.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Captain MIA', 'Break')
                    addToFullReport(gConfigText.msgCaptianMIA, 'Captain MIA', 'Start')

                    reportCaptainMIA.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['hailed', 'hailedChatLines', 'chatLast', 'actionStarted', 'private', 'labelNonEnglish'] )
                        
                        addToFullReport(strToAdd, 'Captain MIA', 'Line')
                    });
                }

                /////////////////////////////////////////////////////////
                ////   Pirate Report Captured
                ////////////////////////////////////////////////////////			
                if (reportCaptured.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Captured', 'Break')
                    addToFullReport(gConfigText.msgCaptured, 'Captured', 'Start')

                    reportCaptured.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['hailed', 'hailedChatLines', 'chatLast', 'actionStarted', 'private', 'labelNonEnglish'] )
                        
                        addToFullReport(strToAdd, 'Captured', 'Line')
                    });
                }
                
                /////////////////////////////////////////////////////////
                ////   Pirate Report Last Rites (Active)
                //////////////////////////////////////////////////////// 
                if (reportLastRitesActivity.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Last Rites Active', 'Break')
                    addToFullReport(gConfigText.msgLastRitesActivity, 'Last Rites Active', 'Start')


                    reportLastRitesActivity.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['hailed', 'hailedChatLines', 'chatLast', 'actionStarted', 'private', 'labelNonEnglish'] )
           
                        addToFullReport(strToAdd, 'Last Rites Active', 'Line')
                    });
                }
                
                /////////////////////////////////////////////////////////
                ////   Pirate Report Just Launched
                ////////////////////////////////////////////////////////
                if (reportJustLaunched.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Just Launched', 'Break')
                    addToFullReport(gConfigText.msgJustLaunched, 'Just Launched', 'Start')

                    reportJustLaunched.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['guildCreated','labelAll', 'private', 'summary'] )


                        addToFullReport(strToAdd, 'Just Launched', 'Line')
                    });
                }

                /////////////////////////////////////////////////////////
                ////   Pirate Report Target Spotted
                ////////////////////////////////////////////////////////
                if (reportTargetSpotted.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Target Spotted', 'Break')
                    addToFullReport(gConfigText.msgTargetSpotted, 'Target Spotted', 'Start')


                    reportTargetSpotted.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['spotted', 'captain', 'chatLines', 'chatLast', 'memberCount', 'actionFinished', 'private','labelNonEnglish'] )

                        addToFullReport(strToAdd, 'Target Spotted', 'Line')
                    });
                }

                /////////////////////////////////////////////////////////
                ////   Pirate Report Do Not Hailed
                ////////////////////////////////////////////////////////
                if (reportDoNotHailed.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Do Not Hail', 'Break')
                    addToFullReport(gConfigText.msgDoNotHail, 'Do Not Hail', 'Start')

                    reportDoNotHailed.forEach(function(obj, index){            
                        
                        strToAdd = createCoveReport_stringCreation(obj, ['spotted', 'hailed', 'chatLines', 'chatLast', 'memberCount', 'labelAll', 'private'] )

                        addToFullReport(strToAdd, 'Do Not Hail', 'Line')

                    });
                }

                /////////////////////////////////////////////////////////
                /////////////////////////////////////////////////////////
                ////   Admiral Captain MIA
                ////////////////////////////////////////////////////////
                if (reportCaptainMIA_admiral.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Admiral Review - Captain MIA', 'Break')
                    addToFullReport(gConfigText.msgCaptianMIA_admiral, 'Admiral Review - Captain MIA', 'Start')

                    reportCaptainMIA_admiral.forEach(function(obj, index){
                        
                        strToAdd = createCoveReport_stringCreation(obj, ['hailed', 'hailedChatLines', 'memberCount', 'actionStarted', 'private', 'labelNonEnglish', 'comment'] )

                        addToFullReport(strToAdd, 'Admiral Review - Captain MIA', 'Line')
                    });
                }

                /////////////////////////////////////////////////////////
                ////   Admiral Captured
                ////////////////////////////////////////////////////////
                if (reportCaptured_admiral.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Admiral Review - Captured', 'Break')
                    addToFullReport(gConfigText.msgCaptured_admiral, 'Admiral Review - Captured', 'Start')

                    reportCaptured_admiral.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['hailed', 'hailedChatLines', 'memberCount', 'actionStarted', 'private', 'labelNonEnglish', 'comment'] )

                        addToFullReport(strToAdd, 'Admiral Review - Captured', 'Line')
                    });
                }            

                /////////////////////////////////////////////////////////
                ////   Admiral Last Rites
                ////////////////////////////////////////////////////////
                if (reportLastRites_admiral.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Admiral Review - Last Rites', 'Break')
                    addToFullReport(gConfigText.msgLastRites_admiral, 'Admiral Review - Last Rites', 'Start')

                    reportLastRites_admiral.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['hailed', 'hailedChatLines', 'memberCount', 'actionStarted', 'private', 'labelNonEnglish', 'comment'] )

                        addToFullReport(strToAdd, 'Admiral Review - Last Rites', 'Line')
                    });
                }  

                /////////////////////////////////////////////////////////
                ////   Admiral Do Not Hail
                ////////////////////////////////////////////////////////
                if (reportDoNotHailed_admiral.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Admiral Review - Do Not Hail', 'Break')
                    addToFullReport(gConfigText.msgDoNotHail_admiral, 'Admiral Review - Do Not Hail', 'Start')

                    reportDoNotHailed_admiral.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['spotted', 'memberCount', 'private', 'labelNonEnglish', 'comment'] )

                        addToFullReport(strToAdd, 'Admiral Review - Do Not Hail', 'Line')
                    });
                } 

                /////////////////////////////////////////////////////////
                ////   Admiral - Target Spotted
                ////////////////////////////////////////////////////////
                if (reportTargetSpotted_admiral.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Admiral Review - Target Spotted', 'Break')
                    addToFullReport(gConfigText.msgTargetSpotted_admiral, 'Admiral Review - Target Spotted', 'Start')

                    reportTargetSpotted_admiral.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['spotted', 'chatLines', 'chatLast', 'memberCount', 'private', 'labelNonEnglish', 'comment'] )

                        addToFullReport(strToAdd, 'Admiral Review - Target Spotted', 'Line')
                    });
                }

                /////////////////////////////////////////////////////////
                ////   Admiral - Just Launched
                ////////////////////////////////////////////////////////
                if (reportJustLaunched_admiral.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Admiral Review - Just Launched', 'Break')
                    addToFullReport(gConfigText.msgJustLaunched_admiral, 'Admiral Review - Just Launched', 'Start')

                    reportJustLaunched_admiral.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['guildCreated','memberCount', 'labelsAll', 'private', 'comment'] )

                        addToFullReport(strToAdd, 'Admiral Review - Just Launched', 'Line')
                    });
                } 

                /////////////////////////////////////////////////////////
                ////   Admiral - Clear Sailing
                ////////////////////////////////////////////////////////
                if (reportClearSailing_admiral.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Admiral Review - Clear Sailing', 'Break')
                    addToFullReport(gConfigText.msgClearSailing_admiral, 'Admiral Review - Clear Sailing', 'Start')

                    reportClearSailing_admiral.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['guildCreated','memberCount', 'captain', 'labelsAll', 'private', 'comment'] )

                        addToFullReport(strToAdd, 'Admiral Review - Clear Sailing', 'Line')
                    });
                } 

                /////////////////////////////////////////////////////////
                ////   Admiral - Private Navy
                ////////////////////////////////////////////////////////
                if (reportPrivateNavy_admiral.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Admiral Review - Private Navy', 'Break')
                    addToFullReport(gConfigText.msgPrivateNavy_admiral, 'Admiral Review - Private Navy', 'Start')

                    reportPrivateNavy_admiral.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['guildCreated','memberCount', 'captain', 'labelsAll', 'private', 'comment'] )

                        addToFullReport(strToAdd, 'Admiral Review - Private Navy', 'Line')
                    });
                }

                /////////////////////////////////////////////////////////
                ////   Admiral - Bermuda Triangle
                ////////////////////////////////////////////////////////
                if (reportBermudaTriangle_admiral.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Admiral Review - Bermuda Triangle', 'Break')
                    addToFullReport(gConfigText.msgBermudaTriangle_admiral, 'Admiral Review - Bermuda Triangle', 'Start')

                    reportBermudaTriangle_admiral.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['guildCreated','memberCount', 'captain', 'labelsAll', 'private', 'comment'] )

                        addToFullReport(strToAdd, 'Admiral Review - Bermuda Triangle', 'Line')
                    });
                }

                /////////////////////////////////////////////////////////
                ////   Determine Last Rites Sunk
                ////////////////////////////////////////////////////////
                if (reportLastRitesSunk.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Last Rites Sunk', 'Break')
                    addToFullReport(gConfigText.msgLastRitesSunk, 'Last Rites Sunk', 'Start')

                    reportLastRitesSunk.forEach(function(obj, index){

                        strToAdd = createCoveReport_stringCreation(obj, ['hailed', 'chatLines',  'memberCount', 'labelsAll', 'private'] )
                        
                        addToFullReport(strToAdd, 'Last Rites Sunk', 'Line')
                    });
                }

                /////////////////////////////////////////////////////////
                ////   reportEnableChallenges
                ////////////////////////////////////////////////////////
                if (reportEnableChallenges.length > 0){
                    addToFullReport(gConfigText.msgSectionBreak, 'Enable Challenges', 'Break')
                    addToFullReport(gConfigText.mgsEnableChallenges, 'Enable Challenges', 'Start')

                    reportEnableChallenges.forEach(function(obj, index){
                     
                        strToAdd = createCoveReport_stringCreation(obj, ['spotted', 'hailed', 'private'] )

                        addToFullReport(strToAdd, 'Enable Challenges', 'Line')
                    });
                }

            } else {
                /////////////////////////////////////////////////////////
                ////   Noting to report
                ////////////////////////////////////////////////////////
                theFullReport[indexFR] += gConfig.msgNothingToSay

            }

            createCoveReport_organizeThePaperwork()
            
            if (gConfig.debug) consoleLogToFile('debug createCoveReport_weeklyActivity END');
        
        }

        /////////////////////////////////////////////////////////
        ////   StringCreator
        ////////////////////////////////////////////////////////
        function createCoveReport_stringCreation(guildId, paraShow){
            if (gConfig.debugVerbose) consoleLogToFile('createCoveReport_stringCreation START guildId: ' + guildId + ' Para: ' + paraShow)
            var strToAdd = '' //return string
            
            //Variables
            var languagesCanHail = []
            var flagNonEnglishHail = false
            var labelDNHTest = false
            var strToAddLabel = ''
			
			
			obj = guildsLatestData[guildId]


            //calculating label variables


            if ((obj != undefined) && (obj.labels != undefined)){
                labelDNHTest = true //set to true here as we can test it
                obj.labels.forEach(function (obj2, index2){
                    if (obj2.id == logLabelNonEnglishHail) flagNonEnglishHail = true
                    if (obj2.color == gConfig.labelColour_Language) languagesCanHail.push(obj2.name)
                    if (obj2.id == gConfig.logLabelDNHOfficial) labelDNHTest = false
                    strToAddLabel += obj2.name + ', '
                })
                if ((labelDNHTest) &&  (obj.habiticaOfficial)) strToAddLabel = gConfig.logLabelDNHOfficialName  + ', ' + strToAddLabel
            } else {
                cards.every(obj3 => { 
                    if (obj3.name == guildId){
                        obj3.labels.forEach(function (obj2, index2){
                            if (obj2.id == logLabelNonEnglishHail) flagNonEnglishHail = true
                            if (obj2.color == gConfig.labelColour_Language) languagesCanHail.push(obj2.name)
                            if (obj2.id == gConfig.logLabelDNHOfficial) labelDNHTest = false
                            strToAddLabel += obj2.name + ', '
                        });
                        return false
                    }
                    return true
                });
            }

            //guildname - Always is added first
            strToAdd += '\n+ [' + masterList[guildId].name + '](' + gConfig.habiticaGuildUrl + guildId + ')'

            //Add the rest of the strings
            if ((obj != undefined) && (paraShow.indexOf('guildCreated') >= 0)) strToAdd += '  **Launched:** ' + moment(obj.cFields[logCustomFields['guildCreated'].id]).format('D MMM YYYY')
            if ((obj != undefined) && ((paraShow.indexOf('spotted') >= 0) && (paraShow.indexOf('hailed') >= 0))) strToAdd += '  **Spotted/Hailed:** ' + moment(obj.cFields[logCustomFields['hailed'].id]).format('D MMM YYYY')
            if ((paraShow.indexOf('spotted') >= 0) && !(paraShow.indexOf('hailed') >= 0)) strToAdd += '  **Spotted:** '  + moment(obj.cFields[logCustomFields['hailed'].id]).format('D MMM YYYY')
            if ((obj != undefined) && (!(paraShow.indexOf('spotted') >= 0) && (paraShow.indexOf('hailed') >= 0))) strToAdd += '  **Hailed:** ' + moment(obj.cFields[logCustomFields['hailed'].id]).format('D MMM YYYY')
            if ((obj != undefined) && (paraShow.indexOf('captain') >= 0)) {
                strToAdd += '  **Captain:** @' +  obj.cFields[logCustomFields['leaderName'].id] + '  **Captain Last Active:** ' +   moment(obj.cFields[logCustomFields['leaderLastLogin'].id]).format('D MMM YYYY') + '  ***Last Chest:*** ' 
                if (obj.leader.items.lastDrop != undefined) {
                    strToAdd +=  moment(obj.leader.items.lastDrop.date).format('D MMM YYYY')
                } else {
                    strToAdd +=  'UNKNOWN'
                }
            }
            if ((obj != undefined) && (paraShow.indexOf('hailedChatLines') >= 0)) strToAdd += '  **Lines Since Hailed:** ' + obj.cFields[logCustomFields['hailedChatLines'].id]

            if (paraShow.indexOf('chatLines') >= 0) strToAdd += '  **Chat Lines:** ' +  obj.cFields[logCustomFields['chatLines'].id]  
            if ((obj != undefined) && (paraShow.indexOf('chatLast') >= 0)) strToAdd += '  **Last Chat:** ' + moment(obj.cFields[logCustomFields['chatLast'].id]).format('D MMM YYYY') 
            if (paraShow.indexOf('memberCount') >= 0) strToAdd += '  **Member Count:** ' +  masterList[guildId].memberCount
            
            if ((obj != undefined) && (paraShow.indexOf('actionFinished') >= 0)) {
                if (obj.cFields[logCustomFields['actionFinished'].id]  != ''){
                    strToAdd += ' **Last Action Finished:** ' + moment(obj.cFields[logCustomFields['actionFinished'].id]).format('D MMM YYYY')  
                    if (obj.cFields[logCustomFields['actionStarted'].id]  != '') strToAdd += ' (' + moment(obj.cFields[logCustomFields['actionFinished'].id]).diff(moment(obj.cFields[logCustomFields['actionStarted'].id]), 'days')  + ' days to complete)'
                }
            }       
            
            if ((obj != undefined) && (paraShow.indexOf('actionStarted') >= 0)) strToAdd += '  **Action Started:** ' + moment(obj.cFields[logCustomFields['actionStarted'].id]).format('D MMM YYYY')
    
            if (paraShow.indexOf('labelAll') >= 0) {
                strToAdd += ' **Flags:** ' 
                if (strToAddLabel.length > 0 ){
                    strToAdd += strToAddLabel.substring(0, strToAddLabel.length-2)
                } else {
                    strToAdd += 'None'
                }
            }

            if (paraShow.indexOf('private') >= 0) if (guildPrivate.indexOf(guildId) >= 0) strToAdd+= '  ***PRIVATE GUILD***'
            if (paraShow.indexOf('labelNonEnglish') >= 0) if (flagNonEnglishHail) strToAdd+= '  **NON-ENGLISH Hail**: ' + languagesCanHail.toString()

            if (paraShow.indexOf('summary') >= 0) strToAdd += '  **Summary:** ' + masterList[guildId].summary

            if ((obj != undefined) && (paraShow.indexOf('comment')) >= 0) {
                if (obj.latestComment == undefined){
                    obj.latestComment = gConfig.msgLogMissingComment
                    consoleLogToFile('******** ERROR ************************ missing Comment info for ' + obj.guild.id )
                }
                strToAdd += '\n> ' + obj.latestComment.replace(/[\n\r]/g, '\r> ');
            }                  
            
            if (gConfig.debugVerbose) consoleLogToFile('createCoveReport_stringCreation RETURN: ' + strToAdd)
            return strToAdd

        }        

        /////////////////////////////////////////////////////////
        ////   Organise and report to guild
        ////////////////////////////////////////////////////////
        function createCoveReport_organizeThePaperwork(){
            if (gConfig.debug) consoleLogToFile('debug createCoveReport_organizeThePaperwork START');
            var call = []
            theFullReport=  _.reverse(theFullReport)
            theFullReport.forEach(function (obj, index){
                if (obj != '' ){
                    if (gConfig.debug) consoleLogToFile(index + ': ' + obj.substring(0, 14))
                    var strToPost = obj
                    if (theFullReport.length > 0) strToPost = ':anchor:*Part ' + (theFullReport.length - index) + ' of ' +  theFullReport.length + '*\n\n' + strToPost
                    
                    var urlToAction = gConfig.botServerUrl + gConfig.botServerPathGroup + '/' +  gConfig.botGuildReport + gConfig.botServerPathChat
                    var newData = {message: strToPost}
                    var item = {action: 'postCoveReport Action: ' + (index + 1) + ' of ' +  theFullReport.length }
                    call.push({targetType: 'bot', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postReport_Success, fnFailure: postReport_Failure, item: item, forcePause: true})
                }
            })
            makeAxiosCall(_.cloneDeep(call))
            if (gConfig.debug) consoleLogToFile('debug createCoveReport_organizeThePaperwork END');
        }

        //////////////////////////////////////////////////////////////////////
        ////    Preparing Full Report
        ///     (Determine chat breaks)
        //////////////////////////////////////////////////////////////////////
        function addToFullReport(strToAdd, listName, sectionName){
            //if (gConfig.debug) consoleLogToFile('debug addToFullReport START');  
            var addTheString = true

            if (strToAdd != undefined){
                //format str first
                strToAdd = prepChatHail(strToAdd)

                // always start a new chat message for each section or if it is too long. 
                if (gConfig.debugVerbose) consoleLogToFile ('debug addToFullReport ' + listName + ' SectionName: ' + sectionName + '; New Report Line.  Index ' + indexFR + '    Chat Length: ' + theFullReport[indexFR].length + '  String to Add Length: ' + strToAdd.length + '  indexFR: ' + indexFR + '  indexFR_firstStart: ' + indexFR_firstStart)
                if (
                    (theFullReport[indexFR].length + strToAdd.length  > gConfig.chatMessageLengthMaxCove) ||
                    (
                        (sectionName == 'Start') && 
                        !(indexFR_firstStart)
                    )){
                    theFullReport.push('')
                    indexFR++
                    if (sectionName == 'Break') addTheString = false
                }
                if (sectionName == 'Start') indexFR_firstStart = false
                if (addTheString) theFullReport[indexFR] += strToAdd
            } else {
                consoleLogToFile('******** ERROR: Undefined add String for List: ' + listName + '      Section: ' + sectionName)
            }
            //if (gConfig.debug) consoleLogToFile('debug addToFullReport END');  
        }
 
        if (gConfig.debug) consoleLogToFile('debug createCoveReport END');  
    }
   
	//////////////////////////////////////////////////////////////////////
    ////    Score task to indicate what activity taken place and when
    //////////////////////////////////////////////////////////////////////
    function postScoreTask(taskToPost){
        if (gConfig.debug) consoleLogToFile('debug postScoreTask START for ' + taskToPost);

        var call = []
        var urlToAction = gConfig.botServerUrl + gConfig.botServerPathCron
        var newData = {}
        var item = {action: 'postScoreTask Action: 1 of 1'}
        call.push({targetType: 'bot', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postReport_Success, fnFailure: postReport_Failure, item: item})					
        makeAxiosCall(_.cloneDeep(call))

        if (gConfig.debug) consoleLogToFile('debug postScoreTask END for ' + taskToPost);
    } //postScoreTask

	//////////////////////////////////////////////////////////////////////
    ////    Cron so bot is always active
    //////////////////////////////////////////////////////////////////////
    function postCron(){
        if (gConfig.debug) consoleLogToFile('debug postCron START');

        var call = []
        var urlToAction = gConfig.botServerUrl + gConfig.botServerPathCron
        var newData = {}
        var item = {action: 'postCron Action: 1 of 1'}
        call.push({targetType: 'bot', requestType: 'POST', urlTo: urlToAction, newData: newData, fnSuccess: postReport_Success, fnFailure: postReport_Failure, item: item})					
        makeAxiosCall(_.cloneDeep(call))

        if (gConfig.debug) consoleLogToFile('debug postCron END');
    } //postCron

    function postReport_Success(data, item){
        if (gConfig.debug) consoleLogToFile('debug postReport_Success ')
        if (gConfig.debug) consoleLogToFile('SUCCESS for action ' + item.action)
    }

    function postReport_Failure(response, item, urlTo){
        consoleLogToFile('debug postReport_Failure ******** ERROR for ' + urlTo)
        if (gConfig.debug) consoleLogToFile('Failure for action ' + item.action)
    }

    if (gConfig.debug) consoleLogToFile('debug reportResults END');
    if (gConfig.debugConsole) console.log('*********************  Done   *********************')
    if (gConfig.debugConsole) console.log('(well almost, might be still finishing off some reports)')
    if ((gConfig.debugConsole) && (gConfig.rptElvenExport) && (testOnlyThisGuild == '')) console.log('(The Elf report takes ages - Over 15mins)')
}

///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////
////  API call functions                          ////////////
//////////////////////////////////////////////////////////////	
function makeAxiosCall(call){
    //Call is an array stucture of object with following fields :
    // {targetType, requestType, urlTo, newData, fnSuccess, fnFailure, item}
    if (gConfig.debugAPI) consoleLogToFile('makeAxiosCall  : ' + call.length)

    if (rl.bot.remaining == undefined) rl.bot.remaining = rl.bot.remainingMax
    if (rl.bot.resetDateTime == undefined) rl.bot.resetDateTime = '2001-07-21T14:12:45Z'
    if (rl.log.remaining == undefined) rl.log.remaining = rl.log.remainingMax
    if (rl.log.resetDateTime == undefined) rl.log.resetDateTime = '2001-07-21T14:12:45Z'
    if (rl.log.lastUsedDateTime == undefined) rl.log.lastUsedDateTime = '2001-07-21T14:12:45Z'

    evalAxiosCall(call)

    function evalAxiosCall(call){
        if (gConfig.debugAPI) consoleLogToFile('debug evalAxiosCall START for call length ' + call.length)

        if (call.length > 0){
            var targetType = call[0].targetType

            if (gConfig.debug) consoleLogToFile('debug evalAxiosCall eval Target Type Remaining ' + rl[targetType].remaining + ' less than Safety : ' +  rl[targetType].remainingSafety +  '    AND  Less than Call Length ' +  call.length + '     AND  Now: ' +  moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')  + ' isBefore last reset time ' + rl[targetType].resetDateTime)
            if (gConfig.debugAPI) consoleLogToFile((rl[targetType].remaining < rl[targetType].remainingSafety))
            if (gConfig.debugAPI) consoleLogToFile((rl[targetType].remaining <= call.length))
            if (gConfig.debugAPI) consoleLogToFile((moment.utc().isBefore(rl[targetType].resetDateTime)))

            if ((rl[targetType].remaining < rl[targetType].remainingSafety) && (rl[targetType].remaining <= call.length) && (moment.utc().isBefore(rl[targetType].resetDateTime))){
                drinksAxiosCall(call)
            } else {
                if (call[0].forcePause == true){
                    forceAxiosCall(call) 
                } else {
                    sendAxiosCall(call)
                }
            }
        }
    }

    function drinksAxiosCall(call){
        if (gConfig.debugAPI) consoleLogToFile('debug drinksAxiosCall START for call length ' + call.length)
        
        var targetType = call[0].targetType
        var timeoutPeriod = Math.floor((Math.random() * rl[targetType].timeoutBasePeriod)) + moment(rl[targetType].resetDateTime).diff(moment.utc(), 'SSSS')

        if (gConfig.debug) consoleLogToFile('Having drinks for ' + timeoutPeriod)
        setTimeout(function (){
            if (gConfig.debug) consoleLogToFile('debug drinksAxiosCall Finish Waiting Remaining ' + rl[targetType].remaining + ' less than Safety : ' +  rl[targetType].remainingSafety +  '    AND  Less than Call Length ' +  call.length + '     AND  Now: ' +  moment.utc().format('YYYY-MM-DDTHH:mm:ssZ') + ' isBefore last reset time ' + rl[targetType].resetDateTime)
			if (call[0].forcePause == true){
                forceAxiosCall(call) 
            } else {
                sendAxiosCall(call)
            }
		}, timeoutPeriod);
    }

    function sendAxiosCall(call){
        if (gConfig.debug) consoleLogToFile('debug sendAxiosCall START for call length ' + call.length)
        var tempBox = []
		var tempBox_MaxWait = 0
        var i = 0
        var targetType = call[0].targetType
        var rlRemainingCurrent = rl[targetType].remaining

        var timeoutPeriodQueue = rl[targetType].timeoutMinPeriod
        if ((rlRemainingCurrent > call.length) && (rlRemainingCurrent >= rl[targetType].remainingSafety)){
			timeoutPeriodQueue = 0
		}

        //done after as we want to keep the timeout not reset.
        if (rlRemainingCurrent < rl[targetType].remainingSafety){
            if (moment.utc().isBefore(rl[targetType].resetDateTime)){
                 rlRemainingCurrent = rl[targetType].remainingSafety  //Assume we had drinks before we got here just do one.
            } else {
                 rlRemainingCurrent = rl[targetType].remainingMax 
            }
        }
    
        call.forEach(function (obj, index){
            if (((rlRemainingCurrent >= rl[targetType].remainingSafety) || (timeoutPeriodQueue == 0)) && (obj.targetType == targetType)){    
                if (gConfig.debug) consoleLogToFile('debug sendAxiosCall Timeout ' + timeoutPeriodQueue + '  rlRemainingCurrent: ' + rlRemainingCurrent + '   Actual:' + rl[targetType].remaining  + '   Safety:' + rl[targetType].remainingSafety  + '   TargeType: ' +  targetType + '   List item TargetType: ' + obj.targetType + '   time: ' + moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'))

                tempBox_MaxWait = timeoutPeriodQueue * i  

                setTimeout(function (){
                    switch (targetType){
                        case 'bot':
                            execAxiosCall_Bot(obj.requestType, obj.urlTo, obj.newData, obj.fnSuccess, obj.fnFailure, obj.item)
                            break;
                        case 'log':
                            execAxiosCall_Log(obj.requestType, obj.urlTo, obj.newData, obj.fnSuccess, obj.fnFailure, obj.item)
                            break;
                        default:
                            consoleLogToFile('******** ERROR: Unable to make API call as targettype not known ' + targetType);
                            if (gConfig.debugConsole) console.log('******** ERROR: Unable to make API call as targettype not known ' + targetType);
                    }

                }, timeoutPeriodQueue * i)
                rlRemainingCurrent--
                i++  
            } else {
				tempBox.push(obj)
			}
        });
        if (gConfig.debug) consoleLogToFile('debug sendAxiosCall Finished Loop TempBox Length: ' + tempBox.length)
        if (tempBox.length > 0){
            setTimeout(function (){
                if (gConfig.debug) consoleLogToFile('Running again to check current RL for the calls of ' + tempBox.length)	
                
                call = tempBox 
                evalAxiosCall(call)
                        
            }, tempBox_MaxWait + timeoutPeriodQueue)
        }
    }

    function forceAxiosCall(call){
        if (gConfig.debug) consoleLogToFile('debug forceAxiosCall START for call length ' + call.length)
        var targetType = call[0].targetType

        switch (targetType){
            case 'bot':
                execAxiosCall_Bot(call[0].requestType, call[0].urlTo, call[0].newData, call[0].fnSuccess, call[0].fnFailure, call[0].item, call)
                break;
            case 'log':
                execAxiosCall_Log(call[0].requestType, call[0].urlTo, call[0].newData, call[0].fnSuccess, call[0].fnFailure, call[0].item, call)
                break;
            default:
                consoleLogToFile('******** ERROR: Unable to make API call as targettype not known ' + targetType);
                if (gConfig.debugConsole) console.log('******** ERROR: Unable to make API call as targettype not known ' + targetType);
        } 
    }

    function execAxiosCall_Bot(requestType, urlTo, newData, fnSuccess, fnFailure, item, forceCall){
        if (gConfig.debugAPI) consoleLogToFile('debug execAxiosCall_Bot START for ' + urlTo)

        var sentParams = ''
        var sentData = ''
        if (requestType == 'GET'){
            sentParams = newData
        } else {
            sentData = newData
        }
        authDet = Buffer.from(gConfig.botAuthUser + ':' + gConfig.botAuthPassword).toString('base64')

        axios({
            method: requestType,
            url: urlTo, 
            params: sentParams,
            data: sentData,
            headers: {'x-client': gConfig.botClientId, 'x-api-user': gConfig.botId,	'x-api-key': gConfig.botToken, 'Authorization': 'Basic ' + authDet},
            response: 'json'
        })
        .then(function (response){
            //handle success
            if (gConfig.debugAPI) consoleLogToFile('debug execAxiosCall_Bot  SUCCESS for ' + urlTo)
            if (gConfig.debugAPI) consoleLogToFile('Remaining Bot: ' + response.headers['x-ratelimit-remaining'] + '  Reset: ' + response.headers['x-ratelimit-reset'])
            var data = response.data
            
            rl.bot.remaining = response.headers['x-ratelimit-remaining']
			rl.bot.resetDateTime = moment(response.headers['x-ratelimit-reset'],'ddd MMM DD YYYY HH:mm:ss Z').utc().format('YYYY-MM-DDTHH:mm:ssZ') //To avoid errors
            if (forceCall != undefined){
                forceCall.shift()
                if (forceCall.length > 0) forceAxiosCall(forceCall)
            }
            fnSuccess(data.data, item)
        }, function (response){
            //handle error
            consoleLogToFile('execAxiosCall_Bot ******** ERROR for ' + requestType + '    ' + urlTo)
            consoleLogToFile('******** ERROR Status code: ' + response.response.status  + '    error: '  + response.response.data.error + '    message: ' + response.response.data.message);

            var data = response.response.data
            var errorCode = response.response.status
            if (errorCode == 429){
                if (gConfig.debugAPI) consoleLogToFile('debug execAxiosCall_Bot ERROR too many tries (429) for ' + urlTo)
                rl.bot.remaining = 0 //None left
                var timeoutPeriod = response.response.headers['retry-after']*1000 + Math.floor((Math.random() * rl.bot.timeoutBasePeriod) + 1);
                if (gConfig.debugAPI) consoleLogToFile('Getting header Retry-After: ' + response.response.headers['retry-after'] + '  ms: ' + timeoutPeriod);
                
                //call again
                setTimeout(function (){
                    execAxiosCall_Bot(requestType, urlTo, newData, fnSuccess, fnFailure, item, forceCall)
                }, timeoutPeriod); 
            } else {
                if (gConfig.debugAPI) consoleLogToFile('debug execAxiosCall_Bot ' + errorCode + ' ******** ERROR for ' + urlTo)
                consoleLogToFile(JSON.stringify(data, null, 2));
                
                var errorOther = false
                // Handle CHAT Errors here
                if (
                    ((errorCode == 400 ) || (errorCode == 401 )) && 
                    (data.message != undefined)
                ){
                    if (
                        (data.message.substring(0,gConfig.apiErrorMessageChat_Swear.length) == gConfig.apiErrorMessageChat_Swear) || 
                        (data.message.substring(0,gConfig.apiErrorMessageChat_Slur.length) == gConfig.apiErrorMessageChat_Slur) || (data.message.substring(0,gConfig.apiErrorMessageChat_Removed.length) == gConfig.apiErrorMessageChat_Removed)
                    ){
                        var guildId = urlTo.substring(urlTo.length - gConfig.botServerPathChat.length - gConfig.botGuildError.length, urlTo.length - gConfig.botServerPathChat.length) //assuming all guildid are the same length

                        var guildName = 'Unknown Guild'
                        if (guildsLatestData[guildId] != undefined){
                            if (guildsLatestData[guildId].guild != undefined) guildName = guildsLatestData[guildId].guild.name.trim()
                        } 
                        if((guildName == 'Unknown Guild') && (masterList[guildId] != undefined)){
                            if (masterList[guildId].name != undefined) guildName = masterList[guildId].name.trim()
                        }

                        if ((data.message.substring(0,gConfig.apiErrorMessageChat_Slur.length) == gConfig.apiErrorMessageChat_Slur)) {
                           consoleLogToFile('debug execAxiosCall_Bot SLUR detected in ' + guildId + ' ( ' + guildName + '). Chat to be reposted to ErrorChatGuild ' + gConfig.urlToErrorChatGuild)
                           if (gConfig.debugConsole) console.log ('******** ERROR execAxiosCall_Bot SLUR detected in ' + guildId + ' ( ' + guildName + '). Chat to be reposted to ErrorChatGuild ' + gConfig.urlToErrorChatGuild)

                            //Can't post value due to SLUR
                            newData.message = gConfigText.msgErrorChatPost
                        } else {
                            consoleLogToFile('debug execAxiosCall_Bot CHAT REMOVED/SWEAR detected in ' + guildId + ' ( ' + guildName + '). Chat to be reposted to ErrorChatGuild ' + gConfig.urlToErrorChatGuild)
                            if (gConfig.debugConsole) console.log ('******** ERROR execAxiosCall_Bot CHAT REMOVED/SWEAR detected in ' + guildId + ' ( ' + guildName + '). Chat to be reposted to ErrorChatGuild ' + gConfig.urlToErrorChatGuild)
                        }
                        newData.message = 'ERROR POSTING TO [' + guildName + '](' + gConfig.habiticaGuildUrl + guildId + ')\n\n' + newData.message
                        newData.message = newData.message.substring(0,3000)
                        
                        execAxiosCall_Bot(requestType, gConfig.urlToErrorChatGuild, newData, fnSuccess, fnFailure, item, forceCall)
                        
                        // Maybe if happens regularly post modest(just id of guilds and users) post or if SLUR Stop all chat posts
                    } else {
                        errorOther = true
                    }
                } else {
                   errorOther = true
                }

                if (errorOther){
                     if (gConfig.debugConsole) console.log(response);
                    rl.bot.remaining = response.response.headers['x-ratelimit-remaining']
                    rl.bot.resetDateTime = moment(response.response.headers['x-ratelimit-reset'],'ddd MMM DD YYYY HH:mm:ss Z').utc().format('YYYY-MM-DDTHH:mm:ssZ') 
                    if (forceCall != undefined){
                        forceCall.shift()
                        if (forceCall.length > 0) forceAxiosCall(forceCall)
                    }
                    fnFailure(data, item, urlTo)
                }
            }
        });               
    }


    function execAxiosCall_Log(requestType, urlTo, newData, fnSuccess, fnFailure, item, forceCall){
        if (gConfig.debugAPI) consoleLogToFile('debug execAxiosCall_Log START for ' + urlTo)
        newData.key = gConfig.logId
        newData.token = gConfig.logToken

        axios({
            method: requestType,
            url: urlTo, 
            data: newData,
			response: 'json'
        })
        .then(function (response){
            //handle success
            if (gConfig.debugAPI) consoleLogToFile('debug execAxiosCall_Log SUCCESS for ' + urlTo)
            if (gConfig.debugAPI) consoleLogToFile('Remaining Log: ' + response.headers['x-rate-limit-api-token-remaining'] )
            
            var data = response
            //Got to be smart about the reset time here.
            if (rl.log.remaining <= data.headers['x-rate-limit-api-token-remaining'])rl.log.resetDateTime = moment(data.headers['date'],  'ddd, DD MMM YYYY hh:mm:ss Z').add(rl.log.resetPeriod, 'ms').format('YYYY-MM-DDTHH:mm:ssZ')
            rl.log.lastUsedDateTime = moment(data.headers['date'], 'ddd, MMM DD YYYY HH:mm:ss Z').format('YYYY-MM-DDTHH:mm:ssZ')
            rl.log.remaining = data.headers['x-rate-limit-api-token-remaining'] 
            if (forceCall != undefined){
                forceCall.shift()
                if (forceCall.length > 0) forceAxiosCall(forceCall)
            }
            fnSuccess(data.data, item)
        }, function (response){
            //handle error
            consoleLogToFile('debug execAxiosCall_Log ******** ERROR for ' + requestType + '    ' + urlTo)
            //console.log(response)            
            consoleLogToFile('Error Status code: ' + response.response.status  + '    error: '  + response.response.data );

            var data = response.response
            consoleLogToFile('************************************************')
            consoleLogToFile(JSON.stringify(data.data))

            if (data.status == 429){
                if (gConfig.debugAPI) consoleLogToFile('debug execAxiosCall_Log ERROR too many tries (429) for ' + urlTo)
                rl.log.remaining = 0
                var timeoutPeriod = moment(data.headers['retry-after'], 'ddd, DD MMM YYYY hh:mm:ss Z').diff(moment(data.headers['date'], 'ddd, DD MMM YYYY hh:mm:ss Z')) + Math.floor((Math.random() * rl.log.timeoutBasePeriod) + 1);
                if (gConfig.debugAPI) consoleLogToFile('Getting header Retry-After: ' + data.headers['retry-after'] + '  ms: ' + timeoutPeriod);
                
                //call again
                setTimeout(function (){
                    execAxiosCall_Log(requestType, urlTo, newData, fnSuccess, fnFailure, item, forceCall)
                }, timeoutPeriod); 
            } else {
                if (gConfig.debugConsole) console.log(response);
                
                if (rl.log.remaining <= data.headers['x-rate-limit-api-token-remaining'])  rl.log.resetDateTime = moment(data.headers['date'],  'ddd, DD MMM YYYY hh:mm:ss Z').add(rl.log.resetPeriod, 'ms').format('YYYY-MM-DDTHH:mm:ssZ')
                rl.log.lastUsedDateTime = moment(data.headers['date'], 'ddd, MMM DD YYYY HH:mm:ss Z').format('YYYY-MM-DDTHH:mm:ssZ')
                rl.log.remaining = data.headers['x-rate-limit-api-token-remaining'] 
                if (forceCall != undefined){
                    forceCall.shift()
                    if (forceCall.length > 0) forceAxiosCall(forceCall)
                }
                fnFailure(data, item, urlTo) 
            }  
        });   
    }
}


///////////////////////////////////////////////////////////////
////  Log To File functions                               ////////////
//////////////////////////////////////////////////////////////	
function consoleLogInitFile(stringToOutput){
    if (gConfig.fileOutput){
        var fileToOutput 
        if (testOnlyThisGuild != ''){
            fileToOutput = gConfig.outputLogSingleFile
        } else {
            //Rotate files
            if (gConfig.outputLogMax > 1){
                for (var i = gConfig.outputLogMax; i > 1; i -= 1){
                    fileToReplace = gConfig.outputLogPrefix + ('0' + i).slice(-2) + gConfig.outputLogSuffix 
                    fileToOutput = gConfig.outputLogPrefix + ('0' + (i-1)).slice(-2) + gConfig.outputLogSuffix

                    if (fs.existsSync(fileToOutput)){
                        //file exists
                    } else {
                        fs.writeFileSync(fileToOutput, 'Missing File' + i)
                    }

                    fs.rename(fileToOutput, fileToReplace, function(err){
                            if (gConfig.debugConsole) if (err) console.log(err);
                    });
                }
            } else {
                fileToOutput = gConfig.outputLogPrefix + '01' + gConfig.outputLogSuffix
            }
        }
        
        streamConsole = fs.createWriteStream(fileToOutput)
        streamConsole.write(stringToOutput, function(err, data){
            if (gConfig.debugConsole) if (err) console.log(err);
            if (gConfig.debugConsole) console.log('Successfully Written to File.');
        });
    } else {    
        console.log(stringToOutput)
    }
}

function consoleLogToFile(stringToOutput){
    if (gConfig.fileOutput){
        streamConsole.write(stringToOutput + '\n', function(err, data){
            if (gConfig.debugConsole) if (err) console.log(err);
        });
    } else {
        console.log(stringToOutput)
    }  
}

//////////////////////////////////////////////////////////////////////
////    Allows for sorting by Numeric Strings
////    Code adpated with thanks from 
////    https://stackoverflow.com/questions/41607150/sort-by-numeric-string-using-sortbyorder-lodash
//////////////////////////////////////////////////////////////////////
function byKeyInt(key){

    return function (o){
        var v = parseInt(_.get(o, key), 10);
        return isNaN(v) ? _.get(o, key) : v;
    };
}


//////////////////////////////////////////////////////////////////////
////    Removes Carriage Returns, headings and HTML links
//////////////////////////////////////////////////////////////////////
function removeFormating(strToModify){
    var result = strToModify
    if (result == undefined) result = ''

    //remove Heading hashes
    result = result.replace(/(\r\n|\n|\r)(#+)/gm,'\n')
    result = result.replace(/^#+/g,'')    

    //remove carriage returns. (Replace with wit a space)
    result = result.replace(/(\r\n|\n|\r)/gm,' ')

    //remove HTML Links
    result = result.replace(/(?:\(https?|ftp):\/\/[\n\S]+/g, '')
    result = result.replace(/(?:https?|ftp):\/\/[\n\S]+/g, '')

    result = result.trim()

    return result
    
}

//////////////////////////////////////////////////////////////////////
////    Replaces variable strings for Chat Messages
//////////////////////////////////////////////////////////////////////
function prepChatHail(strToModify){
    var result = strToModify

    //<%= msgSubTargetSpotted %> //must be before dates as may contain date
    result = result.replace(/<%= msgSubTargetSpotted %>/gm,gConfig.msgSubTargetSpotted)

    result = result.replace(/ <%= dayETClearSailing_MIANoDrop %>/gm,gConfig.dayETClearSailing_MIANoDrop)

    //<%= dateNextETJustLaunched %>
    result = result.replace(/<%= dateNextETJustLaunched %>/gm,gConfig.dateNextETJustLaunched)

    //<%= dateNextETTargetSpotted %>
    result = result.replace(/<%= dateNextETTargetSpotted %>/gm,gConfig.dateNextETTargetSpotted)

    //<%= dateHailReview %>
    result = result.replace(/<%= dateHailReview %>/gm,gConfig.dateHailReview)

    //<%= dateNextNoReponse %>
    result = result.replace(/<%= dateNextNoReponse %>/gm,gConfig.dateNextNoReponse)

    //<%= dayETNoResponse_LastRites %>
    result = result.replace(/<%= dayETNoResponse_LastRites %>/gm,gConfig.dayETNoResponse_LastRites)

    //<%= lowActivityMembers %>
    result = result.replace(/<%= lowActivityMembers %>/gm,gConfig.lowActivityMembers)

    //<%= lowActivityChatLines %>
    result = result.replace(/<%= lowActivityChatLines %>/gm,gConfig.lowActivityChatLines)

    //<%= dayDropAnchor %>
    result = result.replace(/<%= dayDropAnchor %>/gm,gConfig.dayDropAnchor)

    //<%= dayBermudaTriangle %>
    result = result.replace(/<%= dayBermudaTriangle %>/gm,gConfig.dayBermudaTriangle)

    return result
    
}

} //end completeRun

}; //end module.exports  
;