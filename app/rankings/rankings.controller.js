module.exports = (db, Sentry) => {
    return {
        getRankings: async (req, res) => {
            try {
                if (!req.query.year || isNaN(req.query.year)) {
                    res.status(400).send({
                        error: 'A numeric year parameter must be specified.'
                    });

                    return;
                }

                let filter = 'WHERE p.season = $1';
                let params = [req.query.year];

                let index = 2;

                if (req.query.seasonType != 'both') {
                    if (req.query.seasonType && req.query.seasonType != 'regular' && req.query.seasonType != 'postseason' && req.query.seasonType != 'both') {
                        res.status(400).send({
                            error: 'Invalid season type'
                        });
    
                        return;
                    }
                    
                    filter += ` AND p.season_type = $${index}`;
                    params.push(req.query.seasonType || 'regular');
                    index++;
                }

                if (req.query.week) {
                    if (isNaN(req.query.week)) {
                        res.status(400).send({
                            error: 'Week parameter must be numeric'
                        });
    
                        return;
                    }

                    filter += ` AND p.week = $${index}`;
                    params.push(req.query.week);
                    index++;
                }

                let data = await db.any(`   select p.season_type, p.season, p.week, pt.name as poll, pr.rank, t.school, c.name as conference, pr.first_place_votes, pr.points
                                            from poll_type pt
                                                inner join poll p on pt.id = p.poll_type_id
                                                inner join poll_rank pr on p.id = pr.poll_id
                                                inner join team t on pr.team_id = t.id
                                                left join conference_team ct on t.id = ct.team_id AND ct.start_year <= p.season AND (ct.end_year >= p.season OR ct.end_year IS NULL)
                                                left join conference c on ct.conference_id = c.id
                                            ${filter}`, params);


                let results = [];

                let seasons = Array.from(new Set(data.map(d => d.season)));
                for (let season of seasons) {
                    let seasonTypes = Array.from(new Set(data.filter(d => d.season == season).map(d => d.season_type)));
                    for (let seasonType of seasonTypes) {
                        let weeks = Array.from(new Set(data.filter(d => d.season == season && d.season_type == seasonType).map(d => d.week)));
                        for (let week of weeks) {
                            let weekRecord = {
                                season,
                                seasonType,
                                week,
                                polls: []
                            };

                            let records = data.filter(d => d.season == season && d.season_type == seasonType && d.week == week).map(d => d);
                            let polls = Array.from(new Set(records.map(r => r.poll)));

                            for (let poll of polls) {
                                weekRecord.polls.push({
                                    poll,
                                    ranks: records.filter(r => r.poll == poll).map(r => {
                                        return {
                                            rank: r.rank,
                                            school: r.school,
                                            conference: r.conference,
                                            firstPlaceVotes: r.first_place_votes,
                                            points: r.points
                                        }
                                    })
                                });
                            }

                            results.push(weekRecord);
                        }
                    }
                }

                res.send(results);
            } catch (err) {
                Sentry.captureException(err);
                res.status(500).send({
                    error: 'Something went wrong.'
                });
            }
        }
    }
}
