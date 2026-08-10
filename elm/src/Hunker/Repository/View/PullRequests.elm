module Hunker.Repository.View.PullRequests exposing (Config, view)

import Html exposing (Html, a, button, code, div, h1, header, img, p, section, small, span, strong, text)
import Html.Attributes exposing (attribute, class, disabled, href, src, type_)
import Html.Events exposing (onClick)
import Hunker.ApiError as ApiError
import Hunker.Domain.Repository exposing (PullRequest)
import Hunker.Remote exposing (Remote(..))
import Hunker.Repository.Pulls as Pulls
import Hunker.Route exposing (PullRequestState(..))
import Url


type alias Config msg =
    { repository : String
    , owner : String
    , name : String
    , activeState : PullRequestState
    , pulls : Pulls.Model
    , selectedState : PullRequestState -> msg
    , requestedMore : msg
    }


view : Config msg -> Html msg
view config =
    section [ class "repository-pulls-browser" ]
        [ header [ class "repository-pulls-heading" ]
            [ div []
                [ span [] [ text "GitHub" ]
                , h1 [] [ text ("Pull requests for " ++ config.repository) ]
                , p [] [ text "Open a pull request directly in Hunker’s diff view." ]
                ]
            , div [ class "segmented repository-pull-filters" ]
                (List.map (filterButton config) [ OpenPulls, ClosedPulls, AllPulls ])
            ]
        , case Pulls.request config.pulls of
            Loading _ ->
                if List.isEmpty (Pulls.rows config.pulls) then
                    pageState "Loading pull requests…" "Reading pull requests through your GitHub login."

                else
                    rowsView config True

            Failure _ error ->
                if List.isEmpty (Pulls.rows config.pulls) then
                    section [ class "page-state is-error" ] [ h1 [] [ text "Could not load pull requests" ], p [] [ text (ApiError.message error) ] ]

                else
                    div [] [ rowsView config False, p [ class "repository-pull-page-error" ] [ text (ApiError.message error) ] ]

            Success _ _ ->
                rowsView config False

            NotAsked ->
                text ""
        ]


filterButton : Config msg -> PullRequestState -> Html msg
filterButton config state =
    button
        [ type_ "button"
        , class
            ("segmented-button"
                ++ (if config.activeState == state then
                        " is-active"

                    else
                        ""
                   )
            )
        , onClick (config.selectedState state)
        ]
        [ text
            (case state of
                AllPulls ->
                    "All"

                ClosedPulls ->
                    "Closed"

                OpenPulls ->
                    "Open"
            )
        ]


rowsView : Config msg -> Bool -> Html msg
rowsView config loading =
    div [ class "repository-pull-list" ]
        (List.map (rowView config) (Pulls.rows config.pulls)
            ++ (if Pulls.hasMore config.pulls then
                    [ button [ type_ "button", class "repository-pull-load-more", disabled loading, onClick config.requestedMore ]
                        [ text
                            (if loading then
                                "Loading more…"

                             else
                                "Load more"
                            )
                        ]
                    ]

                else
                    []
               )
        )


rowView : Config msg -> PullRequest -> Html msg
rowView config pull =
    a
        [ class "repository-pull-row"
        , href
            ("/"
                ++ Url.percentEncode config.owner
                ++ "/"
                ++ Url.percentEncode config.name
                ++ "/pull/"
                ++ String.fromInt pull.number
                ++ "/files"
            )
        ]
        [ if pull.avatarUrl == "" then
            span [ class "repository-pull-avatar" ] [ text (String.left 2 (String.toUpper pull.author)) ]

          else
            img [ class "repository-pull-avatar", src pull.avatarUrl, attribute "alt" "" ] []
        , span [ class "repository-pull-copy" ]
            [ span [ class "repository-pull-title" ] [ strong [] [ text pull.title ], code [] [ text ("#" ++ String.fromInt pull.number) ] ]
            , small [] [ text (pull.author ++ " · " ++ pull.head ++ " → " ++ pull.base) ]
            , span [ class "repository-pull-labels" ] (List.map (\tag -> span [] [ text tag ]) pull.labels)
            ]
        , span [ class ("repository-pull-state is-" ++ pull.state) ]
            [ text
                (if pull.draft then
                    "Draft"

                 else
                    titleCase pull.state
                )
            ]
        , span [ class "commit-open-arrow" ] [ text "→" ]
        ]


pageState : String -> String -> Html msg
pageState heading detail =
    section [ class "page-state" ] [ span [ class "loading-spinner" ] [], h1 [] [ text heading ], p [] [ text detail ] ]


titleCase : String -> String
titleCase value =
    String.left 1 (String.toUpper value) ++ String.dropLeft 1 value
