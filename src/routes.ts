import { FastifyInstance } from "fastify";
import { z } from 'zod';
import dayjs from 'dayjs'; 
import { prisma } from "./lib/prisma";

export async function appRoutes ( app : FastifyInstance) {
    app.post('/habits',async (request) => {
        const createHabitBody = z.object({
            title: z.string(),
            weekDays: z.array(z.number().min(0).max(6))
        });
        
        const { title, weekDays } = createHabitBody.parse(request.body);

        const today = dayjs().startOf('day').toDate();

        await prisma.habit.create({
            data: {
                title,
                created_at: today,
                weekDays: {
                    create: weekDays.map(weekDay => {
                        return {
                            week_day: weekDay
                        }
                    })
                }
            }
        })
    });

    app.get('/day',async (request) => {
        const getDayParams = z.object({
            date: z.coerce.date()
        });

        const { date } = getDayParams.parse(request.query);

        const parsedDate = dayjs(date).startOf('day');
        // Pega o dia da semana
        const weekDay = parsedDate.get('day');


        /* todos os hábitos possíveis 
        hábitos que já foram criados */

        const possibleHabits = await prisma.habit.findMany({
            where: {
                created_at: {
                    lte: date,
                },
                weekDays: {
                    some: {
                        week_day: weekDay
                    }
                }
            }
        });

        const day = await prisma.day.findUnique({
            where: {
                date: parsedDate.toDate()
            },
            include: {
                dayHabits: true,
            }
        });

        const completedHabits = day?.dayHabits.map(dayHabit => {
            return dayHabit.habit_id
        }) ?? [];

        return {
            possibleHabits,
            completedHabits
        }
    });

    // toogle habit
    app.patch('/habits/:id/toggle',async (request) => {
        
        const toggleHabitParams = z.object({
            id: z.string().uuid()
        });

        const { id } = toggleHabitParams.parse(request.params); 

        const today = dayjs().startOf('day').toDate();

        let day = await prisma.day.findUnique({
            where: {
                date: today
            }
        }); 

        if(!day) {
            day = await prisma.day.create({
                data: {
                    date: today
                }
            });
        }

        const dayHabit = await prisma.dayHabit.findUnique({
            where: {
                day_id_habit_id: {
                    day_id: day.id,
                    habit_id: id
                }
            }
        })

        if(dayHabit) {
            //remover a marcação de completo
            await prisma.dayHabit.delete({
                where: {
                    id: dayHabit.id
                }
            })
        } else {
            //Completar hábito
            await prisma.dayHabit.create({
                data: {
                    day_id: day.id,
                    habit_id: id
                }
            }); 
        }
    }); 

    /* Retorna uma lista de todas os hábitos daquela 
    determinada data que foram ou não completados */
    app.get('/summary',async () => {
        const summary = await prisma.$queryRaw`
            SELECT 
                d.id, 
                d.date,
                (
                    SELECT 
                        cast(count(*) as Float)
                    FROM day_habits as dh
                    WHERE dh.day_id = d.id
                ) as completed,
                (
                    SELECT
                        cast(count(*) as Float)
                    FROM habit_week_days as hwd
                    JOIN habits as H on h.id = hwd.habit_id
                    WHERE 
                        hwd.week_day = cast(strftime('%w', d.date/1000.0, 'unixepoch') as int)
                        AND h.created_at <= d.date
                ) as amount
            FROM days as d
        `
        return { summary }
    });
}