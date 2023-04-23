"use strict";

module.exports = {
    generateRanking,
    displayRankings,
}

const RankingContext = require('./ranking_context');
const DataLoader = require('./data_loader');
const Glicko = require('./glicko');
const Table = require('./table');
const remapValueClamped = require('./util/remap_value_clamped');

const SEED_MODIFIER_FACTORS = {
    bounty: 1,
    selfBounty: 1,
    opponent: 1,
    //selfOpponent: 0,
};

function generateRanking()
{
    // Parameters
    const rankingContext = new RankingContext;
    rankingContext.setHveMod(1).setOutlierCount(5);

    const dataLoader = new DataLoader( rankingContext );
    dataLoader.loadData();

    let teams = dataLoader.teams;
    let matches = dataLoader.matches;

    const glicko = new Glicko();
    glicko.setFixedRD( 75 );        // glicko -> elo

    // Apply seeding
    seedTeams( glicko, teams );

    // Adjust rankings based on games played
    runMatches( glicko, matches );
    teams.forEach( team => { team.rankValue = team.glickoTeam.rank(); } );

    // Remove rosters with no wins from the standings
    teams = teams.filter( t => t.distinctTeamsDefeated > 0 );

    return [matches,teams];
}

function displayRankings( teams, regions = [0,1,2] ) {
    var table = new Table();

    // Sort teams by rank value
    let sortedTeams = [...teams].sort((a, b) => b.rankValue - a.rankValue);

    table.addNumericColumn( 'Standing' );
    table.addNumericColumn( 'Points' ).setPrecision(0)
    table.addColumn( 'Team Name' ).setMinWidth(12);
    table.addColumn( 'Roster' );

    var dispRank = 0;
    sortedTeams.forEach((t, idx) => {
	if (t.matchesPlayed >= 5 && regions.some(r => r === t.region) ) {
            let seedModifiers = t.modifiers;
            let seedModifierValue = calculateSeedModifierValue( seedModifiers );

			dispRank += 1;
            table.addElem( dispRank );
            table.addElem( t.glickoTeam.rank() );
            table.addElem( t.name );
            table.addElem( t.players.map(p => p.nick).join(', ') );
            table.commitRow();
        }
    });

    table.printMarkdown();
}

//--------------------------------------------------------------------------------------------------
//--------------------------------------------------------------------------------------------------
// Seeding Teams
function seedTeams( glicko, teams ) {
    teams.forEach(team => {
        team.seedValue = calculateSeedModifierValue( team.modifiers );
    } );

	// remap teams from current range to minRankValue..maxRankValue
    let minSeedValue = Math.min( ...teams.map(t => t.seedValue ) );
    let maxSeedValue = Math.max( ...teams.map(t => t.seedValue ) );
    
    teams.forEach( team => {
        team.rankValue = remapValueClamped( team.seedValue, minSeedValue, maxSeedValue, 500, 2000 );

        // Save off original rank
        team.rankValueSeed = team.rankValue;

        // create glicko data
        team.glickoTeam = glicko.newTeam( team.rankValue );
    } );
}

function calculateSeedModifierValue( modifiers )
{
    let sumCoeff = 0;
    let scaledMods = 0;
    for( let factor in SEED_MODIFIER_FACTORS )
    {
        sumCoeff   += SEED_MODIFIER_FACTORS[factor];
        scaledMods += SEED_MODIFIER_FACTORS[factor] * modifiers[factor];
    }
    sumCoeff = sumCoeff === 0 ? 1 : sumCoeff;
    return scaledMods / sumCoeff;
}

//--------------------------------------------------------------------------------------------------
//--------------------------------------------------------------------------------------------------
// Adjusting Teams by Results
function runMatches( glicko, matches ) {
    //matches.reverse();
    matches.forEach( match => {
        let team1 = match.team1;
        let team2 = match.team2;

        let [winTeam, loseTeam] = ( match.winningTeam === 1) ? [team1,team2] : [team2,team1];
        glicko.singleMatch( winTeam.glickoTeam, loseTeam.glickoTeam, match.informationContent );
    } );
}

