# Habitica-Pirate-Tools - guildbot
Core code to run @GuildBot. In order to "track" ~~ships~~ guilds it uses Trello. Guilds will be placed in column based on the status of guild, Last Rites, Capture etc. ~~Admirals~~ Admin uses labels to let @GuildBot know when to hail, drop anchor etc. Labels are also used to classify guilds.

## Run command
The code is part of guildbot.js. The command to call the code is guildbot.completeRun.
Paramaters are:
+ **modeEnvironment**: config environment to run, 
+ **testOnlyThisGuild**: guild id if only single guild to be tested. Otherwise zero length string(. ,
+ **botId**: Override botId instead of using one from the config file.  (Useful of repl.it)
+ **botToken**: Override botToken instead of using one from the config file.  (Useful of repl.it)
+ **botAuthUser**: Override Habitica botAuthUser instead of using one from the config file.  (Useful of repl.it)
+ **botAuthPassword**: Override Habitica botAuthPassword instead of using one from the config file.  (Useful of repl.it)
+ **logId**: Override Trello logId instead of using one from the config file.  (Useful of repl.it)
+ **logToken**: Override Trello logToken instead of using one from the config file.  (Useful of repl.it)

### Example
guildbot.completeRun('testing', '', process.env.testbotId, process.env.testbotToken, process.env.testbotAuthUser, process.env.testbotAuthPassword, process.env.testlogId, process.env.testlogToken)

## config.json
Parameter file to run for GuildBot. Each top level key. is a particular mode for GuildBot to run in. Only the *production* key needs to have all the values set. New modes can be created without the need to alter the code. just add a new top level key. 

### Key Descriptions
+ **botId**: Habitica User Id of GuildBot.
+ **botToken**: Habitica User API Token of GuildBot.
+ **botAuthUser**: Username for Habitica API Beta testing. Leave blank for production.
+ **botAuthPassword**: Password for Habitica API Beta testing. Leave blank for production.
+ **logId**: Trello User Id for GuildBot
+ **logToken**: Trello Log Id for GuildBot

+ **folderoutput**: folder for log files and master tracking file.
+ **folderstat**: Stats folder location; Publicly available statistic files produced by GuildBot.
+ **outputFilePrefix**: Output prefix to allow for testing.
+ **outputLogSuffix**: Output Log file suffix.
+ **outputLogMax**:  Number of log files to keep. (Typically 16 to keep just over 2 weeks worth).

+ **folderLang**: Folder where language file translations to keep.
+ **fileLang**: Files used for GuildBot.
+ **hailLangAvail**: Languages available for translations. Two language code kept in array. Eg. [*en*. *de*. *fr*].
+ **hailLangDefault**: Default 2 language code. Should be en for English.

+ **botServerUrl**: Overall Habitica API path.
+ **botServerPathContent**: Content output API path suffix.
+ **botServerPathUser**: User output API path suffix.
+ **botServerPathGroup**: Group output API path suffix.
+ **botServerPathChallengeUser**: User challenge output API path suffix.
+ **botServerPathChallengeGroup**: Group challenge output API path suffix.
+ **botServerPathMemberProfilePart**: Member profile output API path suffix.
+ **botServerPathGroupJoin**: Guild Join API path suffix.
+ **botServerPathChat**: Group chat output API path suffix..
+ **botServerPathCron**: Cron action API path suffix..
+ **botServerPathTask**: Task API path suffix.
+ **botServerPathTaskScoreUp**: Task score up API path suffix.

+ **logServerUrl**: Overall Trello API path.
+ **logServerPathBoardPart**: Boards output API path suffix.
+ **logServerPathCards**: Cards API path suffix.
+ **logServerPathAttachments**: Card Attachments API path suffix.
+ **logServerPathLabels**: Card label API path suffix.
+ **logServerPathList**: List API path suffix.
+ **logServerPathAllCustField**: All card custom fields API path suffix.
+ **logServerPathCustField**: Individual card custom fields output API path suffix.
+ **logServerPathCustFields**: Individual card custom fields fetch(Only) API path suffix.
+ **logServerPathCustFieldItem**: Individual card custom field item API path suffix.
+ **logServerPathComment**: Card comment API path suffix.
+ **logServerPathAction**: Card action API path suffix


+ **botAllOutputToReport**: false.
+ **botGuildCove**: Pirate Cove Guild, where chat is read from.
+ **botGuildElf**: Elven Guild where reports for challenges that are from Last Rites Guilds.
+ **botGuildReport**: Guild where @GuildBot send their reports.
+ **botGuildError**: Guild where @GuildBot send their errors.

+ **botGuildTavern**: Tavern Guild Id (To be ignored)
+ **botGuildTavernAlt**: Alt Tavern Guild Id (To be ignored)

+ **botTaskIdRunAll**: GuildBot Task to be scored every-time the code is run for all guilds.
+ **botTaskIdRunSingle**: GuildBot Task to be scored every-time the code is run for just a single guild.
+ **botTaskIdSentReport**: GuildBot Task every-time the Guild sends a report.

+ **botClientId**: Text that sent with the API to indicate the code is running. 


+ **logServerPathBoardId**: Trello Board Path

+ **logListIdJustLaunchedName**: List name for Just Launched. To match against Trello names.
+ **logListIdClearSailingName**: List name for Clear Sailing. To match against Trello names.
+ **logListIdTargetSpottedName**: List name for Target Spotted. To match against Trello names.
+ **logListIdCaptainMIAName**: List name for Captain MIA. To match against Trello names.
+ **logListIdCapturedName**: List name for Capture. To match against Trello names.
+ **logListIdLastRitesName**: List name for Last Rites. To match against Trello names.
+ **logListIdDoNotHailName**: List name for Do Not Hail. To match against Trello names.
+ **logListIdBermudaTriangleName**: List name for Bermuda Triangle. To match against Trello names.
+ **logListIdPrivateNavyName**: List name for Private Navy. To match against Trello names.
+ **logListIdSunkName**: List name for Sunk. To match against Trello names.


+ **logCustomFields**: Objects of objects for each custom field. For each custom fields, the object is {"id": *Always blank as will be filled out with the code by matching the name*, "name": Custom Field Name, "type": the data type, "defaultValue": Default Value when initialised}

+ **labelColour_DNH**: Label colour for DNH.
+ **labelColour_Language**: Label colour for primary language.
+ **labelColour_LanguageSecondary**: Label colour for secondary language.
+ **labelColour_Category**: Label colour for categories.

+ **logLabelDNHOfficialName**: Exact label name for Habitica Official Guild.
+ **logLabelNonEnglishHailName**: Exact label name for Non English Hail.
+ **logLabelCallForLastRitesName**: Exact label name for Call for Last Rites.
+ **logLabelCallForReHailName**: Exact label name for Call for Hail/ReHail.
+ **logLabelCallForDropAnchorName**: Exact label name for Call to Drop Anchor.
+ **logLabelSailToBermudaTriangleName**: Exact label name for Sail to Bermuda Triangle.
+ **logLabelRemoveActiveCommentName**: Exact label name for Reviewed Admiral Report (Return to Pirates).

+ **logLabelAllLanguagesName**: Exact label name for All Languages.
+ **logLabelDropAnchorName**: Exact label name for Dropped Anchor.
+ **logLabelAdmiralReportName**: Exact label name for Admiral Report.

+ **logLabelLanguage_English**: Exact label name for language label, English.

+ **logCardConfigName**: Exact card name for CONFIG card (holds master data).

+ **habiticaGuildUrl**: URL prefix string for Habitica Guilds.
+ **habiticaChallengeUrl**: URL prefix string for Habitica Challenge
+ **habiticaProfileUrl**: URL prefix string for Habitica Profiles
+ **habiticaCategoryOffical**: Habitica category label id for Habitica Official Guilds

+ **habiticaGuildToolUrl**: Guild Data Tool URL (used for attachment links on the cards)
+ **habiticaGuildToolPathAll**: Guild URL Suffix for all members (used for attachment links on the cards)
+ **habiticaGuildToolPathNone**: Guild URL For no members (used for attachment links on the cards)

+ **chatMessageLengthMax**: Habitica Max Chat message length. 
+ **chatMessageLengthReserved**: Reserved space at the beginning of each message. 

+ **dayETJustLaunched**: Number of days items will be in the Just Launched List. 
+ **dayETClearSailing_Check**: Number of days every guild will be at least checked while the leader is active.
+ **dayETClearSailing_MaybeMIA**: Number of days guild will be checked if the leader is still not active from previous check.
+ **dayETClearSailing_MIA**: Number of days since the leader last logged in, and will be moved to Target Spotted.
+ **dayETClearSailing_MIANoDrop**: Number of days since the leader last had a dropped. (To avoid issues if they been auto crooning).
+ **dayETTargetSpotted**: Number of days before automatic hail of guilds. (To disable, set to very large number). 
+ **dayETNoResponse**: Number of days from Hail, with no other chat messages, to automatically hail for last rites.
+ **dayETNoResponse_LastRites**: Number of days from Last Rites, with no other chat messages, to automatically list in report to be sunk.
+ **dayHailReview**: Used in GuildBots Weekly report to give a date of when it is best to review guilds that been hailed..
+ **dayDropAnchor**: Number of days to dropped anchor for. 
+ **dayBermudaTriangle**: Number of days to dropped anchor for. 

+ **weekdayReport**: Day to check for weekly report. To disable set to negative number. 
+ **dayBetweenReports**: Number of days between weekly report. 

+ **lowActivityChatLines**: Number of chat lines or less for guild to be automatically Last Rites. (Must meet membership requirement too)
+ **lowActivityMembers**: Number of members or less for guild to be automatically Last Rites. (Must meet membership requirement too)

+ **warningFastMovingFromHail**: Number of days to check if the Guild is Fast Moving (chance will fall off the cliff).
+ **warningFastMovingChatLines**: Number of chat lines hail will fall off cliff.
+ **warningHailAlmostInTheOcean**: Number of chat lines to alert hail will fall off the cliff. 

+ **guildColourGold**: Number of members or more for guild to be classified as Gold.
+ **guildColourSilver**: Number of members or more for guild to be classified as Silver.. 
+ **masterDateCheckTo**: Earliest date to ensure all old guilds are checked. (Done to fix old data in stages).
+ **masterDateRoundUp**: Guilds are to be set to creation date on or after this date.
+ **masterDateNew**: Default initialised date. (Set before dates above to force check).

+ **initialLoad**: Used when initialising loading all guild data (to avoid overloading Habitica).
+ **rptElvenExport**: Create Eleven Challenge report?. This takes a while so can be set to false if running tests.
       

+ **testchunk**: Number of guilds per run to test. This is to avoid memory issues.
+ **retryAttemptMax**:  Number of  times to repeat the process the full update/testing process.

+ **rl**: API base reset details.  

+ **apiErrorMessageChat_Swear**: Text used if there is an error with Swear Word.
+ **apiErrorMessageChat_Slur**: Text used if there is an error with a Slur.
+ **apiErrorMessageChat_Removed**: Error message if chat privalges have been blocked. (Occurs if a slur word has been used).

+ **debug**: Show debug information.
+ **debugVerbose**: Show verbose debug information.
+ **debugConsole**: Show debug information to console. (Useful if testing and need to see it is running).
+ **debugAPI**: Show detail debug information with the API. (Useful to help with timeouts etc).
+ **fileOutput**: All debug information (except debugConsole) to output files. 

## configText.json

Text used by @GuildBot to report to pirates, elves, and Admirals, regarding status of ships and/or treasure maps.