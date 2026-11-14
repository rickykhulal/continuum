# Venue Data Refresh Instructions

Internet is fast here. Run these commands in order to update the live data:

1. Ensure `.env` has `FIRMS_MAP_KEY`
2. Delete old CSVs: `Remove-Item data_raw/*.csv` (or `rm data_raw/*.csv`)
3. Run: `npm run live` (Let it finish, should take <2 mins on fast internet)
4. Run: `npm run data`
5. Run: `npm run bundle`
6. Run: `npm run build`
7. Run: `npm test` (Ensure 0 failures)
8. Run: `npm run validate`
9. Run: `npm run smoke`
10. Commit and push: `git add public/data data_raw && git commit -m "Live data refresh at venue" && git push origin main`
