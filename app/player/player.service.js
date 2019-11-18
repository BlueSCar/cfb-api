module.exports = (db) => {

    const playerSearch = async (active, school, position, searchTerm) => {
        let filter = 'WHERE a.active = $1';
        let params = [active == "false" ? false : true];
        let index = 2;

        if (school) {
            filter += ` AND LOWER(t.school) = LOWER($${index})`;
            params.push(school);
            index++;
        }

        if (position) {
            filter += ` AND LOWER(p.abbreviation) = LOWER($${index})`;
            params.push(position);
            index++;
        }

        filter += ` AND LOWER(a.name) LIKE LOWER('%$${index}:value%')`;
        params.push(searchTerm);
        index++;

        const results = await db.any(`
        SELECT a.id, t.school, a.name, a.first_name, a.last_name, a.weight, a.height, a.jersey, p.abbreviation AS "position", h.city || ', ' || h.state AS hometown, '#' || t.color AS color
        FROM athlete AS a
            INNER JOIN team AS t ON a.team_id = t.id
            INNER JOIN "position" AS p ON a.position_id = p.id
            INNER JOIN hometown AS h ON a.hometown_id = h.id
        ${filter}
        ORDER BY a.name
        LIMIT 100
        `, params);

        return results.map(r => ({
            id: r.id,
            team: r.school,
            name: r.name,
            firstName: r.first_name,
            lastName: r.last_name,
            weight: r.weight,
            height: r.height,
            jersey: r.jersey,
            position: r.position,
            hometown: r.hometown,
            teamColor: r.color
        }));
    };

    const getMeanPassingChartData = async (id) => {
        const results = await db.any(`
            WITH plays AS (
                SELECT a.id, a.name, t.school, p.ppa, ROW_NUMBER() OVER(PARTITION BY a.name, t.school ORDER BY g.season, g.week, p.period, p.clock DESC, d.id, p.id) AS row_num
                FROM game AS g
                    INNER JOIN drive AS d ON g.id = d.game_id
                    INNER JOIN play AS p ON d.id = p.drive_id AND p.ppa IS NOT NULL AND p.play_type_id IN (3,4,6,7,24,26,36,51,67)
                    INNER JOIN play_stat AS ps ON p.id = ps.play_id
                    INNER JOIN athlete AS a ON ps.athlete_id = a.id
                    INNER JOIN team AS t ON p.offense_id = t.id
                    INNER JOIN conference_team AS ct ON ct.team_id = t.id AND ct.end_year IS NULL
                    INNER JOIN position AS po ON a.position_id = po.id AND po.abbreviation = 'QB'
                WHERE g.season = 2019 AND a.id = $1
            ), grouped AS (
                SELECT p1.row_num, p2.ppa
                FROM plays AS p1
                    INNER JOIN plays AS p2 ON p2.row_num <= p1.row_num
            )
            SELECT row_num, AVG(ppa) AS avg_ppa
            FROM grouped
            GROUP BY row_num
            ORDER BY row_num
        `, [id]);

        return results.map(r => ({ playNumber: parseInt(r.row_num), avgPPA: r.avg_ppa }));
    };

    const getPlayerUsage = async (season, conference, position, school, playerId, excludeGarbageTime) => {
        let filters = [];
        let params = [];
        let index = 1;

        if (season) {
            filters.push(`g.season = $${index}`);
            params.push(season);
            index++;
        }

        if (conference) {
            filters.push(`LOWER(c.abbreviation) = LOWER($${index})`);
            params.push(conference);
            index++;
        }

        if (position) {
            filters.push(`LOWER(po.abbreviation) = LOWER($${index})`);
            params.push(position);
            index++;
        }

        if (school) {
            filters.push(`LOWER(t.school) = LOWER($${index})`);
            params.push(school);
            index++;
        }

        if (playerId) {
            filters.push(`a.id = $${index}`);
            params.push(playerId);
            index++;
        }
        
        let filter = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

        const results = await db.any(`
            WITH plays AS (
                SELECT DISTINCT g.season,
                                t.id AS team_id,
                                t.school,
                                c.name AS conference,
                                a.id,
                                a.name,
                                po.abbreviation AS position,
                                p.id AS play_id,
                                p.down,
                                CASE
                                    WHEN p.play_type_id IN (3,4,6,7,24,26,36,51,67) THEN 'Pass'
                                    WHEN p.play_type_id IN (5,9,29,39,68) THEN 'Rush'
                                    ELSE 'Other'
                                END AS play_type,
                                CASE
                                    WHEN p.down = 2 AND p.distance >= 8 THEN 'passing'
                                    WHEN p.down IN (3,4) AND p.distance >= 5 THEN 'passing'
                                    ELSE 'standard'
                                END AS down_type,
                                CASE
                                    WHEN p.period = 2 AND p.scoring = false AND ABS(p.home_score - p.away_score) > 38 THEN true
                                    WHEN p.period = 3 AND p.scoring = false AND ABS(p.home_score - p.away_score) > 28 THEN true
                                    WHEN p.period = 4 AND p.scoring = false AND ABS(p.home_score - p.away_score) > 22 THEN true
                                    WHEN p.period = 2 AND p.scoring = true AND ABS(p.home_score - p.away_score) > 45 THEN true
                                    WHEN p.period = 3 AND p.scoring = true AND ABS(p.home_score - p.away_score) > 35 THEN true
                                    WHEN p.period = 4 AND p.scoring = true AND ABS(p.home_score - p.away_score) > 29 THEN true
                                    ELSE false
                                END AS garbage_time,
                                p.ppa
                FROM game AS g
                    INNER JOIN game_team AS gt ON g.id = gt.game_id
                    INNER JOIN team AS t ON gt.team_id = t.id
                    INNER JOIN conference_team AS ct ON t.id = ct.team_id AND ct.end_year IS NULL
                    INNER JOIN conference AS c ON ct.conference_id = c.id
                    INNER JOIN drive AS d ON g.id = d.game_id
                    INNER JOIN play AS p ON d.id = p.drive_id AND p.offense_id = t.id AND p.ppa IS NOT NULL
                    INNER JOIN play_stat AS ps ON p.id = ps.play_id
                    INNER JOIN athlete AS a ON ps.athlete_id = a.id AND a.team_id = t.id
                    INNER JOIN position AS po ON a.position_id = po.id
                ${filter}
            ), teams AS (
                SELECT 	g.season,
                        t.id,
                        t.school,
                        p.down,
                        CASE
                            WHEN p.play_type_id IN (3,4,6,7,24,26,36,51,67) THEN 'Pass'
                            WHEN p.play_type_id IN (5,9,29,39,68) THEN 'Rush'
                            ELSE 'Other'
                        END AS play_type,
                        CASE
                            WHEN p.down = 2 AND p.distance >= 8 THEN 'passing'
                            WHEN p.down IN (3,4) AND p.distance >= 5 THEN 'passing'
                            ELSE 'standard'
                        END AS down_type,
						CASE
							WHEN p.period = 2 AND p.scoring = false AND ABS(p.home_score - p.away_score) > 38 THEN true
							WHEN p.period = 3 AND p.scoring = false AND ABS(p.home_score - p.away_score) > 28 THEN true
							WHEN p.period = 4 AND p.scoring = false AND ABS(p.home_score - p.away_score) > 22 THEN true
							WHEN p.period = 2 AND p.scoring = true AND ABS(p.home_score - p.away_score) > 45 THEN true
							WHEN p.period = 3 AND p.scoring = true AND ABS(p.home_score - p.away_score) > 35 THEN true
							WHEN p.period = 4 AND p.scoring = true AND ABS(p.home_score - p.away_score) > 29 THEN true
							ELSE false
						END AS garbage_time,
                        p.ppa
                FROM game AS g
                    INNER JOIN game_team AS gt ON g.id = gt.game_id
                    INNER JOIN team AS t ON gt.team_id = t.id
                    INNER JOIN conference_team AS ct ON t.id = ct.team_id AND ct.end_year IS NULL
                    INNER JOIN conference AS c ON ct.conference_id = c.id
                    INNER JOIN drive AS d ON g.id = d.game_id
                    INNER JOIN play AS p ON d.id = p.drive_id AND p.offense_id = t.id AND p.ppa IS NOT NULL
                WHERE g.season = $1
            ), team_counts AS (
                SELECT 	season,
                        id,
                        school,
                        COUNT(*) AS plays,
                        COUNT(*) FILTER(WHERE play_type = 'Rush') AS rush,
                        COUNT(*) FILTER(WHERE play_type = 'Pass') AS pass,
                        COUNT(*) FILTER(WHERE down = 1) AS first_downs,
                        COUNT(*) FILTER(WHERE down = 2) AS second_downs,
                        COUNT(*) FILTER(WHERE down = 3) AS third_downs,
                        COUNT(*) FILTER(WHERE down_type = 'standard') AS standard_downs,
                        COUNT(*) FILTER(WHERE down_type = 'passing') AS passing_downs
                FROM teams
                ${excludeGarbageTime ? 'WHERE garbage_time = false' : ''}
                GROUP BY season, id, school
            )
            SELECT p.season,
                p.id,
                p."name",
                p.position,
                p.school,
                p.conference,
                ROUND(CAST(CAST(COUNT(p.ppa) AS NUMERIC) / t.plays AS NUMERIC), 4) AS overall_usage,
                ROUND(CAST(CAST(COUNT(p.ppa) FILTER(WHERE p.play_type = 'Pass') AS NUMERIC) / t.pass AS NUMERIC), 4) AS pass_usage,
                ROUND(CAST(CAST(COUNT(p.ppa) FILTER(WHERE p.play_type = 'Rush') AS NUMERIC) / t.rush AS NUMERIC), 4) AS rush_usage,
                ROUND(CAST(CAST(COUNT(p.ppa) FILTER(WHERE p.down = 1) AS NUMERIC) / t.first_downs AS NUMERIC), 4) AS first_down_usage,
                ROUND(CAST(CAST(COUNT(p.ppa) FILTER(WHERE p.down = 2) AS NUMERIC) / t.second_downs AS NUMERIC), 3) AS second_down_usage,
                ROUND(CAST(CAST(COUNT(p.ppa) FILTER(WHERE p.down = 3) AS NUMERIC) / t.third_downs AS NUMERIC), 3) AS third_down_usage,
                ROUND(CAST(CAST(COUNT(p.ppa) FILTER(WHERE p.down_type = 'standard') AS NUMERIC) / t.standard_downs AS NUMERIC), 3) AS standard_down_usage,
                ROUND(CAST(CAST(COUNT(p.ppa) FILTER(WHERE p.down_type = 'passing') AS NUMERIC) / t.passing_downs AS NUMERIC), 3) AS passing_down_usage
            FROM plays AS p
                INNER JOIN team_counts AS t ON p.team_id = t.id
            WHERE position IN ('QB', 'RB', 'FB', 'TE', 'WR') ${excludeGarbageTime ? 'AND p.garbage_time = false' : ''}
            GROUP BY p.season, p.id, p."name", p.position, p.school, p.conference, t.plays, t.pass, t.rush, t.first_downs, t.second_downs, t.third_downs, t.standard_downs, t.passing_downs
            ORDER BY overall_usage DESC
        `, params);

        return results.map(r => ({
            season: r.season,
            id: r.id,
            name: r.name,
            position: r.position,
            team: r.school,
            conference: r.conference,
            usage: {
                overall: parseFloat(r.overall_usage),
                pass: parseFloat(r.pass_usage),
                rush: parseFloat(r.rush_usage),
                firstDown: parseFloat(r.first_down_usage),
                secondDown: parseFloat(r.second_down_usage),
                thirdDown: parseFloat(r.third_down_usage),
                standardDowns: parseFloat(r.standard_down_usage),
                passingDowns: parseFloat(r.passing_down_usage)
            }
        }));
    };

    return {
        playerSearch,
        getMeanPassingChartData,
        getPlayerUsage
    };
};