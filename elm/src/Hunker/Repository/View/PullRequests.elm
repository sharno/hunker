module Hunker.Repository.View.PullRequests exposing (Config, view)

import Html exposing (Html, a, button, code, div, h1, header, img, p, section, small, span, strong, text)
import Html.Attributes exposing (attribute, class, classList, disabled, href, src, type_)
import Html.Events exposing (onClick)
import Hunker.ApiError as ApiError
import Hunker.Domain.Git as Git exposing (RepositoryId)
import Hunker.Domain.Repository exposing (PullRequest, PullRequestState(..), PullRequestStatus(..))
import Hunker.Repository.Pulls as Pulls exposing (Footer(..), Status(..))
import Hunker.Repository.View.Local as Local
import Hunker.Route as Route


type alias Config msg =
    { repository : RepositoryId
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
                , h1 [] [ text ("Pull requests for " ++ Git.repositoryToString config.repository) ]
                , p [] [ text "Open a pull request directly in Hunker’s diff view." ]
                ]
            , div [ class "segmented repository-pull-filters" ]
                (List.map (filterButton config) [ OpenPulls, ClosedPulls, AllPulls ])
            ]
        , case Pulls.status config.pulls of
            FirstLoading ->
                Local.pageState "Loading pull requests…" "Reading pull requests through your GitHub login."

            FirstFailed error ->
                Local.errorState "Could not load pull requests" error

            Empty ->
                emptyState config.activeState

            Rows rows footer ->
                div [ class "repository-pull-list" ] (List.map (rowView config) rows ++ footerView config footer)
        ]


filterButton : Config msg -> PullRequestState -> Html msg
filterButton config state =
    button
        [ type_ "button"
        , classList [ ( "segmented-button", True ), ( "is-active", config.activeState == state ) ]
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


footerView : Config msg -> Footer -> List (Html msg)
footerView config footer =
    let
        loadMore loading =
            button [ type_ "button", class "repository-pull-load-more", disabled loading, onClick config.requestedMore ]
                [ text
                    (if loading then
                        "Loading more…"

                     else
                        "Load more"
                    )
                ]
    in
    case footer of
        NoMore ->
            []

        CanLoadMore ->
            [ loadMore False ]

        LoadingMore ->
            [ loadMore True ]

        LoadMoreFailed error ->
            [ p [ class "repository-pull-page-error", attribute "role" "alert" ] [ text (ApiError.message error) ], loadMore False ]


emptyState : PullRequestState -> Html msg
emptyState state =
    section [ class "page-state repository-pulls-empty" ]
        [ h1 []
            [ text
                (case state of
                    OpenPulls ->
                        "No open pull requests"

                    ClosedPulls ->
                        "No closed pull requests"

                    AllPulls ->
                        "No pull requests"
                )
            ]
        , p [] [ text "Try another filter or open this repository on GitHub." ]
        ]


rowView : Config msg -> PullRequest -> Html msg
rowView config pull =
    a
        [ class "repository-pull-row"
        , href (Route.toPath (Route.Review { repository = config.repository, subject = Route.PullRequest pull.number (Route.PullFiles Nothing) }))
        ]
        [ case pull.avatarUrl of
            Just avatar ->
                img [ class "repository-pull-avatar", src avatar, attribute "alt" "" ] []

            Nothing ->
                span [ class "repository-pull-avatar" ] [ text (String.left 2 (String.toUpper pull.author)) ]
        , span [ class "repository-pull-copy" ]
            [ span [ class "repository-pull-title" ] [ strong [] [ text pull.title ], code [] [ text ("#" ++ String.fromInt pull.number) ] ]
            , small [] [ text (pull.author ++ " · " ++ pull.head ++ " → " ++ pull.base) ]
            , span [ class "repository-pull-labels" ] (List.map (\tag -> span [] [ text tag ]) pull.labels)
            ]
        , statusBadge pull.status
        , span [ class "commit-open-arrow" ] [ text "→" ]
        ]


statusBadge : PullRequestStatus -> Html msg
statusBadge status =
    let
        badge modifier label =
            span [ class ("repository-pull-state is-" ++ modifier) ] [ text label ]
    in
    case status of
        DraftPull ->
            badge "open" "Draft"

        OpenPull ->
            badge "open" "Open"

        MergedPull ->
            badge "merged" "Merged"

        ClosedPull ->
            badge "closed" "Closed"
